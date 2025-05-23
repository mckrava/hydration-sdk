import {
  IPersistentEmaOracleEntry,
  IPersistentMetaData,
  IPersistentStableSwapBase,
  IPersistentStableSwapBasePegSource,
  PersistentAsset,
} from '../types';
import { AMOUNT_MAX, StableMath, StableSwapBase } from '../../stable';
import { toPoolFee } from '../../../utils/mapper';
import { Asset } from '../../../types';
import { OfflinePoolUtils } from './OfflinePoolUtils';
import { BigNumber } from '../../../utils/bignumber';
import { TRADEABLE_DEFAULT } from '../../../consts';
import { PoolFee, PoolToken } from '../../types';

export class StableSwapOfflineUtils {
  static getStableswapPegsFromPersistentData({
    src,
    emaOraclesData,
    metaData,
  }: {
    src: IPersistentStableSwapBase;
    emaOraclesData: IPersistentEmaOracleEntry[];
    metaData: IPersistentMetaData;
  }): Pick<StableSwapBase, 'pegs' | 'pegsFee'> {
    if (!src.pegSources) {
      return this.getPoolDefaultPegs({ poolFee: src.fee, assets: src.tokens });
    }

    // TODO Should be reviewed
    const sortedAssetIds = src.tokens
      .map((t) => Number(t.id))
      .sort((a, b) => a - b)
      .map((id) => id.toString());

    const latestPegs = StableSwapOfflineUtils.getLatestPegs({
      poolAssetIds: sortedAssetIds,
      pegSources: src.pegSources,
      blockNumber: metaData.paraBlockNumber.toString(),
      emaOraclesData,
    });
    const recentPegs = src.pegs!;
    const maxPegUpdate = src.maxPegUpdate!;
    const fee = src.fee;

    const [updatedFee, updatedPegs] = StableMath.recalculatePegs(
      JSON.stringify(recentPegs),
      JSON.stringify(latestPegs),
      metaData.paraBlockNumber.toString(),
      BigNumber(maxPegUpdate / 10000).toFixed(2, BigNumber.ROUND_DOWN),
      BigNumber(fee / 10000).toFixed(2, BigNumber.ROUND_DOWN)
    );

    const updatedFeePermill = Number(updatedFee) * 10000;
    return {
      pegsFee: toPoolFee(updatedFeePermill),
      pegs: updatedPegs,
    };
  }

  protected static getPoolDefaultPegs({
    poolFee,
    assets,
  }: {
    poolFee: number;
    assets: Array<PersistentAsset | Asset>;
  }): { pegsFee: PoolFee; pegs: string[][] } {
    const defaultFee = poolFee;
    const defaultPegs = StableMath.defaultPegs(assets.length);
    return {
      pegsFee: toPoolFee(defaultFee),
      pegs: defaultPegs,
    };
  }

  private static getLatestPegs({
    poolAssetIds,
    pegSources,
    blockNumber,
    emaOraclesData,
  }: {
    poolAssetIds: string[];
    pegSources: IPersistentStableSwapBasePegSource[];
    blockNumber: string;
    emaOraclesData: IPersistentEmaOracleEntry[];
  }) {
    const emaOraclesDecoratedMap =
      OfflinePoolUtils.decorateEmaOraclesPersistentData(emaOraclesData);

    const latest = pegSources.map((source, i) => {
      if (source.sourceKind === 'Oracle') {
        const { oracleName, oraclePeriod, oracleAsset } = source;

        const oracleKeyList = [oracleAsset, poolAssetIds[i]]
          .map((a) => Number(a))
          .sort((a, b) => a - b);

        const oracleEntry = emaOraclesDecoratedMap
          .get(oracleName!)!
          .get(oraclePeriod!)!
          .get(oracleKeyList.join('-'));

        if (!oracleEntry) throw Error(`EmaOracleEntry has not been found`);

        const { price, updatedAt } = oracleEntry;

        const priceNum = price.n.toString();
        const priceDenom = price.d.toString();

        return `${oracleAsset}` === oracleKeyList[0].toString()
          ? [[priceNum, priceDenom], updatedAt.toString()]
          : [[priceDenom, priceNum], updatedAt.toString()];
      } else {
        return [source.valuePoints!.map((p) => p.toString()), blockNumber];
      }
    });

    return latest;
  }

  static getPoolTokensAugmented({
    poolId,
    poolTokens,
    assets,
  }: {
    poolId: string;
    poolTokens: PoolToken[];
    assets: Array<PersistentAsset>;
  }): PoolToken[] {
    const poolShareAsset = assets.find((a) => a.id === poolId);
    if (!poolShareAsset) throw Error(`Pool share asset has not been found`);

    return [
      ...poolTokens,
      OfflinePoolUtils.decorateBasePoolToken({
        id: poolShareAsset.id,
        decimals: poolShareAsset.decimals,
        symbol: poolShareAsset.symbol,
        balance: AMOUNT_MAX.toString(),
        existentialDeposit: poolShareAsset.existentialDeposit,
        isSufficient: poolShareAsset.isSufficient,
        type: poolShareAsset.type,
        tradable: TRADEABLE_DEFAULT,
      }),
    ];
  }
}
