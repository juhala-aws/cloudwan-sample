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
import { Workload } from './workload'

const cloudWanStackRef = new pulumi.StackReference('central-network')
const coreNetworkId = cloudWanStackRef.getOutput('coreNetworkId')
const cloudWanAccountId = cloudWanStackRef.getOutput('accountId')

const providerUsEast1 = new aws.Provider('us-east-1', { region: 'us-east-1' })
const providerEuWest1 = new aws.Provider('eu-west-1', { region: 'eu-west-1' })

/* eslint-disable no-new */
new Workload(
  'WorkloadProdUS',
  {
    provider: providerUsEast1
  },
  {
    vpcCidr: '10.0.0.0/22',
    region: providerUsEast1.region,
    coreNetworkId,
    cloudWanAccountId,
    cloudWanSegment: 'prod'
  }
)

new Workload(
  'WorkloadNonProdUS',
  {
    provider: providerUsEast1
  },
  {
    vpcCidr: '10.0.4.0/22',
    region: providerUsEast1.region,
    coreNetworkId,
    cloudWanAccountId,
    cloudWanSegment: 'nonprod'
  }
)

new Workload(
  'WorkloadProdEU',
  {
    provider: providerEuWest1
  },
  {
    vpcCidr: '10.0.8.0/22',
    region: providerEuWest1.region,
    coreNetworkId,
    cloudWanAccountId,
    cloudWanSegment: 'prod'
  }
)

new Workload(
  'WorkloadNonProdEU',
  {
    provider: providerEuWest1
  },
  {
    vpcCidr: '10.0.12.0/22',
    region: providerEuWest1.region,
    coreNetworkId,
    cloudWanAccountId,
    cloudWanSegment: 'nonprod'
  }
)
