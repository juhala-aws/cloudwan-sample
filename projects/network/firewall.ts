// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.

// Permission is hereby granted, free of charge, to any person obtaining a copy of this
// software and associated documentation files (the "Software"), to deal in the Software
// without restriction, including without limitation the rights to use, copy, modify,
// merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
// INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
// PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
// HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
// SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

/* eslint-disable no-new */

import * as awsx from '@pulumi/awsx'
import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'

interface FirewallArgs {
  vpcCidr: string,
  coreNetworkId: pulumi.Output<any>,
  region: string,
  organisationCidr: string,
  numberOfAzs?: number,
  cloudWanAccountId: pulumi.Output<any>
}

export class Inspection extends pulumi.ComponentResource {
  private readonly organisationCidr: string
  private readonly numberOfAzs: number
  private readonly cloudWanAccountId: pulumi.Output<any>
  private readonly coreNetworkId: pulumi.Output<any>
  private readonly vpc: awsx.ec2.Vpc
  private readonly firewall: aws.networkfirewall.Firewall

  public readonly cloudWanAttachment: aws.networkmanager.VpcAttachment

  constructor (name: string, opts: pulumi.ComponentResourceOptions, args: FirewallArgs) {
    super(`cloudwanExample:Inspection-${name}`, name, args, opts)

    this.organisationCidr = args.organisationCidr
    this.numberOfAzs = args.numberOfAzs ?? 2
    this.cloudWanAccountId = args.cloudWanAccountId
    this.coreNetworkId = args.coreNetworkId

    this.vpc = new awsx.ec2.Vpc(
      'InspectionVpc',
      {
        cidrBlock: args.vpcCidr,
        numberOfAvailabilityZones: this.numberOfAzs,
        subnets: [
          { type: 'isolated', name: 'CloudWanAttachments', cidrMask: 24 },
          { type: 'private', name: 'Firewall', cidrMask: 24 },
          { type: 'public', name: 'Public', cidrMask: 24 }
        ],
        tags: {
          name: 'InspectionVPC'
        }
      },
      {
        parent: this
      }
    )

    this.firewall = this.createFirewall()

    this.cloudWanAttachment = this.createCloudWanAttachment(args.region)

    this.createRoutes()

    this.registerOutputs()
  }

  private createRoutes () {
    pulumi.all([this.firewall.firewallStatuses, this.vpc.isolatedSubnets, this.vpc.publicSubnets])
      .apply(([statuses, isoSubnets, pubSubnets]) => {
        const endpointId: {[az:string]: string} = {}

        statuses.forEach(status => {
          status.syncStates.forEach(state => {
            state.attachments.forEach(attachment => {
              endpointId[state.availabilityZone] = attachment.endpointId
            })
          })
        })

        isoSubnets.forEach(subnet => {
          subnet.subnet.availabilityZone.apply(az => {
            if (endpointId[az] && subnet.routeTable) {
              new aws.ec2.Route(
              `CloudWanSubnetRouteToFW-${subnet.subnetName}`,
              {
                vpcEndpointId: endpointId[az],
                routeTableId: subnet.routeTable.id,
                destinationCidrBlock: '0.0.0.0/0'
              }, {
                parent: this,
                dependsOn: [this.firewall]
              }
              )
            }
          })
        })

        pubSubnets.forEach(subnet => {
          subnet.subnet.availabilityZone.apply(az => {
            if (endpointId[az] && subnet.routeTable) {
              new aws.ec2.Route(
                `PublicSubnetRouteToFW-${subnet.subnetName}`,
                {
                  vpcEndpointId: endpointId[az],
                  routeTableId: subnet.routeTable.id,
                  destinationCidrBlock: this.organisationCidr
                },
                {
                  parent: this,
                  dependsOn: [this.firewall]
                }
              )
            }
          })
        })
      })
  }

  private createCloudWanAttachment (region: string): aws.networkmanager.VpcAttachment {
    const subnetArns = pulumi.all([this.vpc.isolatedSubnetIds, this.coreNetworkId, this.vpc.id, this.cloudWanAccountId])
      .apply(([subnetIds, coreNetworkId, vpcId, cloudWanAccountId]) => {
        return subnetIds.map(subnetId => `arn:aws:ec2:${region}:${cloudWanAccountId}:subnet/${subnetId}`)
      })

    return new aws.networkmanager.VpcAttachment('VpcAttachment',
      {
        coreNetworkId: this.coreNetworkId,
        vpcArn: pulumi.interpolate`arn:aws:ec2:${region}:${this.cloudWanAccountId}:vpc/${this.vpc.vpc.id}`,
        subnetArns,
        tags: {
          sharedservices: 'cloudwan-segment'
        }
      },
      { parent: this })
  }

  private createFirewall (): aws.networkfirewall.Firewall {
    const statelessAllowRuleGroup = new aws.networkfirewall.RuleGroup(
      'StatelessAllowRuleGroup',
      {
        capacity: 10,
        type: 'STATELESS',
        ruleGroup: {
          rulesSource: {
            statelessRulesAndCustomActions: {
              statelessRules: [
                {
                  priority: 1,
                  ruleDefinition: {
                    actions: ['aws:pass'],
                    matchAttributes: {
                      protocols: [1],
                      sources: [{
                        addressDefinition: '0.0.0.0/0'
                      }],
                      destinations: [{
                        addressDefinition: '0.0.0.0/0'
                      }]
                    }
                  }
                }
              ]
            }
          }
        }
      },
      {
        parent: this,
        ignoreChanges: ['ruleGroup']
      }
    )

    const statefulAllowRuleGroup = new aws.networkfirewall.RuleGroup(
      'StatefulAllowRuleGroup',
      {
        capacity: 10,
        type: 'STATEFUL',
        ruleGroup: {
          rulesSource: {
            statefulRules: [
              {
                action: 'PASS',
                header: {
                  destination: 'ANY',
                  destinationPort: '80',
                  source: this.organisationCidr,
                  sourcePort: 'ANY',
                  protocol: 'TCP',
                  direction: 'FORWARD'
                },
                ruleOptions: [{
                  keyword: 'sid: 1'
                }]
              },
              {
                action: 'PASS',
                header: {
                  destination: 'ANY',
                  destinationPort: '443',
                  source: this.organisationCidr,
                  sourcePort: 'ANY',
                  protocol: 'TCP',
                  direction: 'FORWARD'
                },
                ruleOptions: [{
                  keyword: 'sid: 2'
                }]
              },
              {
                action: 'PASS',
                header: {
                  destination: 'ANY',
                  destinationPort: '123',
                  source: this.organisationCidr,
                  sourcePort: 'ANY',
                  protocol: 'UDP',
                  direction: 'FORWARD'
                },
                ruleOptions: [{
                  keyword: 'sid: 3'
                }]
              }
            ]
          }
        }
      },
      {
        parent: this,
        ignoreChanges: ['ruleGroup']
      }
    )

    const denyRuleGroup = new aws.networkfirewall.RuleGroup(
      'DenyRuleGroup',
      {
        capacity: 10,
        type: 'STATEFUL',
        ruleGroup: {
          rulesSource: {
            statefulRules: [
              {
                action: 'DROP',
                header: {
                  destination: 'ANY',
                  destinationPort: 'ANY',
                  source: 'ANY',
                  sourcePort: 'ANY',
                  protocol: 'IP',
                  direction: 'FORWARD'
                },
                ruleOptions: [{
                  keyword: 'sid: 100'
                }]
              }
            ]
          }
        }
      },
      {
        parent: this,
        ignoreChanges: ['ruleGroup']
      }
    )

    const firewallPolicy = new aws.networkfirewall.FirewallPolicy(
      'FirewallPolicy',
      {
        firewallPolicy: {
          statelessDefaultActions: ['aws:forward_to_sfe'],
          statelessFragmentDefaultActions: ['aws:forward_to_sfe'],
          statelessRuleGroupReferences: [
            { resourceArn: statelessAllowRuleGroup.arn, priority: 1 }
          ],
          statefulRuleGroupReferences: [
            { resourceArn: statefulAllowRuleGroup.arn },
            { resourceArn: denyRuleGroup.arn }
          ]
        }
      },
      {
        parent: this
      }
    )

    const subnetIds = this.vpc.privateSubnetIds
    const subnetMappings = pulumi.all([subnetIds]).apply(([subnetIds]) => {
      return subnetIds.map(id => { return { subnetId: id } })
    })

    return new aws.networkfirewall.Firewall(
      'NetworkFirewall',
      {
        vpcId: this.vpc.id,
        subnetMappings,
        firewallPolicyArn: firewallPolicy.arn

      },
      {
        parent: this,
        ignoreChanges: ['subnetMappings']
      }
    )
  }
}
