import {
  Abi,
  EvmChain,
  FeeAmount,
  FeeAmountConfigBuilder,
  Parachain,
  Snowbridge as Sb,
  Wormhole as Wh,
} from '@galacticcouncil/xcm-core';

import {
  BRIDGE_HUB_ID,
  buildERC20TransferFromPara,
  buildParaERC20Received,
} from './extrinsics/xcm';
import { padFeeByPercentage } from './utils';

import { dot } from '../assets';
import { BaseClient, AssethubClient } from '../clients';

function TokenRelayer() {
  return {
    calculateRelayerFee: (): FeeAmountConfigBuilder => ({
      build: async ({ feeAsset, destination, source }) => {
        const ctx = source as EvmChain;
        const rcv = destination as EvmChain;

        const ctxWh = Wh.fromChain(ctx);
        const rcvWh = Wh.fromChain(rcv);

        const feeAssetId = ctx.getAssetId(feeAsset);
        const feeAssetDecimals = ctx.getAssetDecimals(feeAsset);
        const relayerFee = await ctx.client.getProvider().readContract({
          abi: Abi.TokenRelayer,
          address: ctxWh.getTokenRelayer() as `0x${string}`,
          args: [
            rcvWh.getWormholeId(),
            feeAssetId as `0x${string}`,
            feeAssetDecimals,
          ],
          functionName: 'calculateRelayerFee',
        });
        return { amount: relayerFee } as FeeAmount;
      },
    }),
  };
}

function Wormhole() {
  return {
    TokenRelayer,
  };
}

type SendFeeOpts = {
  hub: Parachain;
};

function Snowbridge() {
  return {
    calculateInboundFee: (opts: SendFeeOpts): FeeAmountConfigBuilder => ({
      build: async ({ feeAsset, destination, source }) => {
        const ctx = source as EvmChain;
        const rcv = destination as Parachain;

        const ctxSb = Sb.fromChain(ctx);

        const paraClient = new BaseClient(rcv);
        const hubClient = new AssethubClient(opts.hub);

        const xcm = await buildParaERC20Received(feeAsset, rcv);

        const [destinationFee, deliveryFee] = await Promise.all([
          paraClient.calculateDestinationFee(xcm, dot),
          hubClient.calculateDeliveryFee(xcm, rcv.parachainId),
        ]);

        const bridgeFeeInDot =
          deliveryFee + padFeeByPercentage(destinationFee, 25n);

        const feeAssetId = ctx.getAssetId(feeAsset);
        const bridgeFeeInWei = await ctx.client.getProvider().readContract({
          abi: Abi.Snowbridge,
          address: ctxSb.getGateway() as `0x${string}`,
          args: [feeAssetId as `0x${string}`, rcv.parachainId, bridgeFeeInDot],
          functionName: 'quoteSendTokenFee',
        });
        return {
          amount: bridgeFeeInWei,
          breakdown: { bridgeFeeInDot: bridgeFeeInDot },
        } as FeeAmount;
      },
    }),
    calculateOutboundFee: (opts: SendFeeOpts): FeeAmountConfigBuilder => ({
      build: async ({ transferAsset, feeAsset, source }) => {
        const ctx = source as Parachain;

        const client = new AssethubClient(opts.hub);

        const xcm = await buildERC20TransferFromPara(transferAsset, ctx);
        const returnToSenderXcm = await buildParaERC20Received(
          transferAsset,
          ctx
        );

        const [
          bridgeDeliveryFee,
          bridgeHubDeliveryFee,
          assetHubDestinationFee,
          returnToSenderDeliveryFee,
          returnToSenderDestinationFee,
        ] = await Promise.all([
          client.getBridgeDeliveryFee(),
          client.calculateDeliveryFee(xcm, BRIDGE_HUB_ID),
          client.calculateDestinationFee(xcm, feeAsset),
          client.calculateDeliveryFee(returnToSenderXcm, ctx.parachainId),
          client.calculateDestinationFee(returnToSenderXcm, feeAsset),
        ]);

        const bridgeFeeInDot =
          bridgeDeliveryFee +
          bridgeHubDeliveryFee +
          padFeeByPercentage(assetHubDestinationFee, 25n) +
          returnToSenderDeliveryFee +
          padFeeByPercentage(returnToSenderDestinationFee, 25n);

        return {
          amount: bridgeFeeInDot,
          breakdown: {
            bridgeDeliveryFee: bridgeDeliveryFee,
            bridgeHubDeliveryFee: bridgeHubDeliveryFee,
            assetHubDestinationFee: assetHubDestinationFee,
            returnToSenderDeliveryFee: returnToSenderDeliveryFee,
            returnToSenderDestinationFee: returnToSenderDestinationFee,
          },
        } as FeeAmount;
      },
    }),
  };
}

export function FeeAmountBuilder() {
  return {
    Snowbridge,
    Wormhole,
  };
}
