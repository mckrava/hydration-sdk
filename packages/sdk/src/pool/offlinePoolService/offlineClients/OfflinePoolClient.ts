import { Asset, PoolBase, PoolFees, PoolPair, PoolType } from '../../../types';
import {
  AssetDynamicFee,
  IOfflinePoolServiceDataSource,
  IPersistentConstants,
  IPersistentEmaOracleAssetEntry,
  IPersistentEmaOracleEntry,
  IPersistentMetaData,
  PersistentAsset,
} from '../types';

export abstract class OfflinePoolClient {
  protected pools: PoolBase[] = [];
  private assets: Map<string, PersistentAsset> = new Map([]);
  protected constants: IPersistentConstants;
  protected emaOracleEntries: Map<
    PoolType,
    Map<string, IPersistentEmaOracleEntry>
  > = new Map([]);
  protected dataSourceMeta: IPersistentMetaData;

  abstract isSupported(): boolean;
  abstract getPoolType(): PoolType;
  abstract getPoolFees(poolPair: PoolPair, address: string): Promise<PoolFees>;

  protected constructor(
    dataSource: IOfflinePoolServiceDataSource,
    poolType: PoolType
  ) {
    this.pools =
      dataSource.pools[poolType.toLowerCase() as keyof typeof dataSource.pools];
    this.constants = dataSource.constants;
    this.dataSourceMeta = dataSource.meta;

    for (const poolType in dataSource.emaOracle) {
      this.emaOracleEntries.set(
        poolType as PoolType,
        new Map(
          (
            dataSource.emaOracle[
              poolType as PoolType
            ] as Array<IPersistentEmaOracleAssetEntry>
          ).map((i) => [`${i.assetId}`, i.entry])
        )
      );
    }
  }

  get augmentedPools() {
    return this.pools.filter((p) => this.isValidPool(p));
  }

  /**
   * Check if pool valid. Only XYK pools are being verified as those are
   * considered permissionless.
   *
   * @param pool - asset pool
   * @returns true if pool valid & assets known by registry, otherwise false
   */
  private isValidPool(pool: PoolBase): boolean {
    return pool.type === PoolType.XYK
      ? pool.tokens.every((t) => this.assets.get(t.id))
      : true;
  }

  getPools(): PoolBase[] {
    return this.augmentedPools;
  }

  /**
   * Update registry assets, evict mempool
   *
   * @param assets - registry assets
   */
  withAssets(assets: PersistentAsset[]) {
    this.assets = new Map(
      assets.map((asset: PersistentAsset) => [asset.id, asset])
    );
  }

  protected getAssetDynamicFee(assetId: string): AssetDynamicFee {
    if (!this.assets.has(assetId))
      throw Error('Asset not found: ' + assetId + '');
    return this.assets.get(assetId)!.dynamicFee;
  }
}
