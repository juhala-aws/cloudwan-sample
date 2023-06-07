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

interface WorkloadArgs {
  vpcCidr: string;
  numberOfAzs?: number;
  region: pulumi.Output<aws.Region|undefined>;
  coreNetworkId: pulumi.Output<any>;
  cloudWanAccountId: pulumi.Output<any>;
  cloudWanSegment: string;
}

export class Workload extends pulumi.ComponentResource {
  constructor (name: string, opts: pulumi.ComponentResourceOptions, args: WorkloadArgs) {
    super(`cloudwanExample:workload-${name}`, name, args, opts)

    const vpc = new awsx.ec2.Vpc(
      `WorkloadVpc-${name}`,
      {
        cidrBlock: args.vpcCidr,
        numberOfAvailabilityZones: args.numberOfAzs ?? 2,
        subnets: [
          { type: 'isolated', name: 'Workload', cidrMask: 24 }
        ],
        tags: {
          Name: `WorkloadVpc-${name}`
        }
      },
      {
        parent: this
      }
    )

    const subnetIds = vpc.isolatedSubnetIds

    const cloudWanAttachment = new aws.cloudcontrol.Resource(
      'VpcAttachment',
      {
        typeName: 'AWS::NetworkManager::VpcAttachment',
        desiredState: pulumi.all([args.coreNetworkId, vpc.id, args.cloudWanAccountId, args.region, subnetIds]).apply(([coreNetworkId, vpcId, cloudWanAccountId, regionId, subnetIds]) => {
          const subnetArns:string[] = subnetIds.map(subnetId => `arn:aws:ec2:${regionId}:${cloudWanAccountId}:subnet/${subnetId}`)
          return JSON.stringify(
            {
              CoreNetworkId: coreNetworkId,
              VpcArn: `arn:aws:ec2:${regionId}:${cloudWanAccountId}:vpc/${vpcId}`,
              SubnetArns: subnetArns,
              Tags: [
                { Key: args.cloudWanSegment, Value: 'cloudwan-segment' }
              ]
            }
          )
        }
        )
      },
      { parent: this }
    )

    const coreNetworkArn = pulumi.all([args.cloudWanAccountId, args.coreNetworkId]).apply(([accountId, coreNetworkId]) => {
      return `arn:aws:networkmanager::${accountId}:core-network/${coreNetworkId}`
    })

    vpc.isolatedSubnets.then(
      (subnets) => {
        subnets.forEach(subnet => {
          if (subnet.routeTable) {
            new aws.ec2.Route(
              `DefaultRouteToCloudWan-${subnet.subnetName}`,
              {
                coreNetworkArn,
                destinationCidrBlock: '0.0.0.0/0',
                routeTableId: subnet.routeTable.id
              },
              {
                parent: this,
                dependsOn: cloudWanAttachment
              }
            )
          }
        })
      }
    )

    const AL2 = pulumi.output(aws.ec2.getAmi({
      mostRecent: true,
      filters: [
        {
          name: 'name',
          values: ['amzn2-ami-hvm*']
        },
        {
          name: 'architecture',
          values: ['x86_64']
        }
      ],
      owners: ['amazon']
    },
    {
      parent: this
    }
    ))

    const endpointSg = new aws.ec2.SecurityGroup(
      'EndpointSecurityGroup',
      {
        vpcId: vpc.id,
        ingress: [
          {
            protocol: 'tcp',
            fromPort: 443,
            toPort: 443,
            cidrBlocks: [args.vpcCidr]
          }
        ]
      },
      {
        parent: this
      }
    )

    vpc.isolatedSubnetIds.then(
      (ids) => {
        new aws.ec2.VpcEndpoint(
          'SsmEndpoint',
          {
            serviceName: pulumi.interpolate`com.amazonaws.${args.region}.ssm`,
            vpcId: vpc.id,
            vpcEndpointType: 'Interface',
            securityGroupIds: [endpointSg.id],
            subnetIds: ids,
            privateDnsEnabled: true
          },
          {
            parent: this
          }
        )

        new aws.ec2.VpcEndpoint(
          'SsmMessagesEndpoint',
          {
            serviceName: pulumi.interpolate`com.amazonaws.${args.region}.ssmmessages`,
            vpcId: vpc.id,
            vpcEndpointType: 'Interface',
            securityGroupIds: [endpointSg.id],
            subnetIds: ids,
            privateDnsEnabled: true
          },
          {
            parent: this
          }
        )

        new aws.ec2.VpcEndpoint(
          'Ec2MessagesEndpoint',
          {
            serviceName: pulumi.interpolate`com.amazonaws.${args.region}.ec2messages`,
            vpcId: vpc.id,
            vpcEndpointType: 'Interface',
            securityGroupIds: [endpointSg.id],
            subnetIds: ids,
            privateDnsEnabled: true
          },
          {
            parent: this
          }
        )
      }
    )

    const workloadSg = new aws.ec2.SecurityGroup(
      `WorkloadSecurityGroup${name}`,
      {
        vpcId: vpc.id,
        ingress: [
          {
            protocol: 'icmp',
            fromPort: 8,
            toPort: 8,
            cidrBlocks: ['0.0.0.0/0']
          }
        ],
        egress: [
          {
            protocol: 'tcp',
            fromPort: 0,
            toPort: 65535,
            cidrBlocks: ['0.0.0.0/0']
          },
          {
            protocol: 'icmp',
            fromPort: -1,
            toPort: -1,
            cidrBlocks: ['0.0.0.0/0']
          }
        ]
      },
      {
        parent: this
      }
    )

    const ssmRole = new aws.iam.Role(
      'ssmRole',
      {
        managedPolicyArns: [
          'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'
        ],
        assumeRolePolicy: JSON.stringify(
          {
            Version: '2012-10-17',
            Statement: [{
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Sid: '',
              Principal: { Service: 'ec2.amazonaws.com' }
            }]
          }
        ),
        tags: {
          Name: 'ssmRole'
        }
      },
      {
        parent: this
      }
    )

    const ssmInstanceProfile = new aws.iam.InstanceProfile(
      'ssmInstanceProfile',
      {
        role: ssmRole.name
      },
      {
        parent: this
      }
    )

    vpc.isolatedSubnetIds.then(
      (ids) => {
        new aws.ec2.Instance(
          `WorkloadInstance-${name}`,
          {
            ami: AL2.imageId,
            iamInstanceProfile: ssmInstanceProfile,
            instanceType: 't3.micro',
            subnetId: ids[0],
            vpcSecurityGroupIds: [workloadSg.id],
            tags: {
              Name: `Workload-${name}`
            }
          },
          { parent: this }
        )
      }
    )

    this.registerOutputs()
  }
}
