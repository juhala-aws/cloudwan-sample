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

import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import { CloudWanPolicy } from './policy'

interface CloudWanArgs {
  regions: string[],
  policy?: CloudWanPolicy
}

export class CloudWAN extends pulumi.ComponentResource {
  readonly globalNetwork: aws.networkmanager.GlobalNetwork
  readonly coreNetwork: aws.networkmanager.CoreNetwork

  constructor (name: string, opts: pulumi.ComponentResourceOptions, args: CloudWanArgs) {
    super('cloudwanExample:cloudWan', name, args, opts)

    this.globalNetwork = new aws.networkmanager.GlobalNetwork(
      'GlobalNet',
      {
        description: 'Global Net',
        tags: {
          Name: 'Global Net'
        }
      },
      {
        parent: this
      }
    )

    this.coreNetwork = new aws.networkmanager.CoreNetwork(
      'CoreNet',
      {
        globalNetworkId: this.globalNetwork.id,
        basePolicyRegions: args.regions,
        createBasePolicy: true
      }
    )
  }
}
