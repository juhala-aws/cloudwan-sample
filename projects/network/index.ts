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

import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { CloudWAN } from './cloudwan'
import { Inspection } from './firewall'

// Organisation CIDR to target VPC behind AWS Cloud WAN network.
// Export it for reuse in other stacks.
export const organisationCidr = '10.0.0.0/8'

// CloudWAN segments
// const segments = ['prod', 'nonprod']

// CloudWAN regions
const regions = ['eu-west-1', 'us-east-1']

// Try to fetch Cloud WAN attachment IDs as StackReferences from Inspection stack.
// If those are gotten. Update Cloud WAN policy file accordingly.
// const firewallStackRef = new pulumi.StackReference('inspection-demo')
// const attachmentIds = firewallStackRef.getOutput('attachmentIds')

const providerUsEast1 = new aws.Provider('us-east-1', { region: 'us-east-1' })
const providerEuWest1 = new aws.Provider('eu-west-1', { region: 'eu-west-1' })

const identity = pulumi.output(aws.getCallerIdentity())

const cloudwan = new CloudWAN(
  'CloudWan',
  {
    provider: providerUsEast1
  },
  {
    regions
  }
)

const firewallUS = new Inspection(
  'InspectionUS',
  {
    provider: providerUsEast1,
    dependsOn: cloudwan.coreNetwork
  },
  {
    vpcCidr: '10.200.0.0/16',
    coreNetworkId: cloudwan.coreNetwork.id,
    region: 'us-east-1',
    organisationCidr,
    cloudWanAccountId: identity.accountId
  }
)

const firewallEU = new Inspection(
  'InspectionEU',
  {
    provider: providerEuWest1,
    dependsOn: cloudwan.coreNetwork
  },
  {
    vpcCidr: '10.200.0.0/16',
    coreNetworkId: cloudwan.coreNetwork.id,
    region: 'eu-west-1',
    organisationCidr,
    cloudWanAccountId: identity.accountId
  }
)

const policy = pulumi.all([firewallEU.cloudWanAttachment.id, firewallUS.cloudWanAttachment.id])
  .apply(([EUID, USID]) => {
    return {
      version: '2021.12',
      segments: [
        {
          name: 'prod',
          'isolate-attachments': true,
          'require-attachment-acceptance': false,
          'edge-locations': [
            'eu-west-1',
            'us-east-1'
          ]
        },
        {
          name: 'sharedservices',
          'isolate-attachments': true,
          'require-attachment-acceptance': false,
          'edge-locations': [
            'eu-west-1',
            'us-east-1'
          ]
        }
      ],
      'core-network-configuration': {
        'asn-ranges': ['65412-65534'],
        'edge-locations': [
          {
            location: 'eu-west-1'
          },
          {
            location: 'us-east-1'
          }
        ]
      },
      'attachment-policies': [
        {
          'rule-number': 100,
          conditions: [
            {
              type: 'tag-exists',
              key: 'prod'
            }
          ],
          action: {
            'association-method': 'constant',
            segment: 'prod'
          }
        },
        {
          'rule-number': 200,
          conditions: [
            {
              type: 'tag-exists',
              key: 'sharedservices'
            }
          ],
          action: {
            'association-method': 'constant',
            segment: 'sharedservices'
          }
        }
      ],
      'segment-actions': [
        {
          action: 'share',
          mode: 'attachment-route',
          segment: 'sharedservices',
          'share-with': '*'
        },
        {
          action: 'create-route',
          'destination-cidr-blocks': [
            '0.0.0.0/0'
          ],
          destinations: [
            USID,
            EUID
          ],
          segment: 'prod'
        }
      ]
    }
  })

const policyAttachment = new aws.networkmanager.CoreNetworkPolicyAttachment(
  'CoreNetworkPolicyAttachment',
  {
    coreNetworkId: cloudwan.coreNetwork.id,
    policyDocument: pulumi.jsonStringify(policy)
  },
  {
    dependsOn: [
      firewallEU,
      firewallUS
    ]
  }
)

// export Stack variables
export const coreNetworkId = cloudwan.coreNetwork.id
export const cloudWANAccountId = identity.accountId
