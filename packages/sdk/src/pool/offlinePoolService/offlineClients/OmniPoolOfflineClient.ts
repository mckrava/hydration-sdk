import { OfflinePoolClient } from './OfflinePoolClient';
import {
  AssetDynamicFee,
  IOfflinePoolServiceDataSource,
  IPersistentEmaOracleAssetEntry,
  IPersistentEmaOracleEntry,
} from '../types';
import { PoolFees, PoolPair, PoolType } from 'types';
import { HUB_ASSET_ID, SYSTEM_ASSET_ID } from '../../../consts';
import { Option, u32 } from '@polkadot/types-codec';
import { ITuple } from '@polkadot/types-codec/types';
import type {
  PalletDynamicFeesFeeEntry,
  PalletEmaOracleOracleEntry,
} from '@polkadot/types/lookup';
import { toPct, toPoolFee } from '../../../utils/mapper';
import { OmniPoolFees } from '../../omni/OmniPool';
import { OmniMath } from '../../omni/OmniMath';

type OmniPoolFeeRange = [number, number, number];

export class OmniPoolOfflineClient extends OfflinePoolClient {
  constructor(dataSource: IOfflinePoolServiceDataSource) {
    super(dataSource, PoolType.Omni);
  }

  isSupported(): boolean {
    return this.pools.length > 0;
  }

  getPoolType(): PoolType {
    return PoolType.Omni;
  }

  async getPoolFees(poolPair: PoolPair, _address: string): Promise<PoolFees> {
    const feeAsset = poolPair.assetOut;
    const protocolAsset = poolPair.assetIn;

    // const oracleName = 'omnipool';
    // const oraclePeriod = 'Short';
    //
    // const oracleKey = (asset: string) => {
    //   return asset === SYSTEM_ASSET_ID
    //     ? [SYSTEM_ASSET_ID, HUB_ASSET_ID]
    //     : [HUB_ASSET_ID, asset];
    // };

    const blockNumber = this.dataSourceMeta.paraBlockNumber;
    const dynamicFees = this.getAssetDynamicFee(feeAsset);
    const oracleAssetFee = this.getAssetEmaOracleEntry(feeAsset);
    const oracleProtocolFee = this.getAssetEmaOracleEntry(protocolAsset);

    // const [blockNumber, dynamicFees, oracleAssetFee, oracleProtocolFee] =
    //   await Promise.all([
    //     this.api.query.system.number(),
    //     this.api.query.dynamicFees.assetFee(feeAsset),
    //     this.api.query.emaOracle.oracles<
    //       Option<ITuple<[PalletEmaOracleOracleEntry, u32]>>
    //     >(oracleName, oracleKey(feeAsset), oraclePeriod),
    //     this.api.query.emaOracle.oracles<
    //       Option<ITuple<[PalletEmaOracleOracleEntry, u32]>>
    //     >(oracleName, oracleKey(protocolAsset), oraclePeriod),
    //   ]);

    const [assetFeeMin, assetFee, assetFeeMax] = this.getAssetFee(
      poolPair,
      blockNumber,
      dynamicFees,
      oracleAssetFee
    );

    const [protocolFeeMin, protocolFee, protocolFeeMax] =
      protocolAsset === HUB_ASSET_ID
        ? [0, 0, 0] // No protocol fee for LRNA sell
        : this.getProtocolFee(
            poolPair,
            blockNumber,
            dynamicFees,
            oracleProtocolFee
          );

    const min = assetFeeMin + protocolFeeMin;
    const max = assetFeeMax + protocolFeeMax;

    return {
      assetFee: toPoolFee(assetFee),
      protocolFee: toPoolFee(protocolFee),
      min: toPoolFee(min),
      max: toPoolFee(max),
    } as OmniPoolFees;
  }

  protected getAssetEmaOracleEntry(assetId: string): IPersistentEmaOracleEntry {
    if (!this.emaOracleEntries.has(PoolType.Omni))
      throw Error('EmaOracle entries not found for pool type Omni');

    if (!this.emaOracleEntries.get(PoolType.Omni)!.has(assetId))
      throw Error(
        `EmaOracle entries not found for pool type Omni and assetId ${assetId}`
      );
    return this.emaOracleEntries.get(PoolType.Omni)!.get(assetId)!;
  }

  private getAssetFee(
    poolPair: PoolPair,
    blockNumber: number,
    dynamicFee: AssetDynamicFee,
    oracleEntry: IPersistentEmaOracleEntry
  ): OmniPoolFeeRange {
    const { assetOut, balanceOut } = poolPair;

    const { minFee, maxFee, decay, amplification } =
      this.constants.dynamicFeesAssetFeeParameters;

    const feeMin = toPoolFee(minFee);
    const feeMax = toPoolFee(maxFee);

    if (!dynamicFee || !oracleEntry) {
      return [minFee, minFee, maxFee];
    }

    const { assetFee, timestamp } = dynamicFee;

    const blockDifference = blockNumber - timestamp;

    let oracleAmountIn = oracleEntry.volume.bIn;
    let oracleAmountOut = oracleEntry.volume.bOut;
    let oracleLiquidity = oracleEntry.liquidity.b;

    if (assetOut === SYSTEM_ASSET_ID) {
      oracleAmountIn = oracleEntry.volume.aIn;
      oracleAmountOut = oracleEntry.volume.aOut;
      oracleLiquidity = oracleEntry.liquidity.a;
    }

    const feePrev = toPoolFee(assetFee);
    const fee = OmniMath.recalculateAssetFee(
      oracleAmountIn,
      oracleAmountOut,
      oracleLiquidity,
      '9',
      balanceOut.toString(),
      toPct(feePrev).toString(),
      blockDifference.toString(),
      toPct(feeMin).toString(),
      toPct(feeMax).toString(),
      decay.toString(),
      amplification.toString()
    );
    return [minFee, Number(fee) * 10000, maxFee];
  }

  private getProtocolFee(
    poolPair: PoolPair,
    blockNumber: number,
    dynamicFee: AssetDynamicFee,
    oracleEntry: IPersistentEmaOracleEntry
  ): OmniPoolFeeRange {
    const { assetIn, balanceIn } = poolPair;

    const { minFee, maxFee, decay, amplification } =
      this.constants.dynamicFeesAssetFeeParameters;

    const feeMin = toPoolFee(minFee);
    const feeMax = toPoolFee(maxFee);

    if (!dynamicFee || !oracleEntry) {
      return [minFee, minFee, maxFee];
    }

    const { protocolFee, timestamp } = dynamicFee;

    const blockDifference = blockNumber - timestamp;

    let oracleAmountIn = oracleEntry.volume.bIn.toString();
    let oracleAmountOut = oracleEntry.volume.bOut.toString();
    let oracleLiquidity = oracleEntry.liquidity.b.toString();

    if (assetIn === SYSTEM_ASSET_ID) {
      oracleAmountIn = oracleEntry.volume.aIn.toString();
      oracleAmountOut = oracleEntry.volume.aOut.toString();
      oracleLiquidity = oracleEntry.liquidity.a.toString();
    }

    const feePrev = toPoolFee(protocolFee);
    const fee = OmniMath.recalculateProtocolFee(
      oracleAmountIn,
      oracleAmountOut,
      oracleLiquidity,
      '9',
      balanceIn.toString(),
      toPct(feePrev).toString(),
      blockDifference.toString(),
      toPct(feeMin).toString(),
      toPct(feeMax).toString(),
      decay.toString(),
      amplification.toString()
    );
    return [minFee, Number(fee) * 10000, maxFee];
  }
}
