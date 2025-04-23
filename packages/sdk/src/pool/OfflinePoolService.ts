import { memoize1 } from '@thi.ng/memoize';
import { PoolNotFound } from '../errors';
import {
  Asset,
  ExternalAsset,
  Hop,
  IPoolService,
  Pool,
  PoolBase,
  PoolFee,
  PoolFees,
  PoolPair,
  PoolToken,
  PoolType,
  Transaction,
} from '../types';
import { BigNumber, bnum, scale } from '../utils/bignumber';

import { StableSwapBase } from './stable/StableSwap';
import { LbpPoolBase, WeightedPoolToken } from './lbp/LbpPool';
import { OmniPoolBase, OmniPoolToken } from './omni/OmniPool';
import { toPoolFee } from '../utils/mapper';
import { LbpMath } from './lbp/LbpMath';
import { StableMath } from './stable/StableMath';

export enum AssetType {
  Bond = 'Bond',
  External = 'External',
  StableSwap = 'StableSwap',
  Token = 'Token',
  XYK = 'XYK',
  Erc20 = 'Erc20',
  PoolShare = 'PoolShare',
}

export interface PersistentAsset extends Partial<Asset> {
  id: string;
  decimals: number;
  symbol: string;
  existentialDeposit: string;
  isSufficient: boolean;
  type: AssetType;
}

export interface IPersistentPoolToken extends Partial<PoolToken> {
  id: string;
  decimals: number;
  symbol: string;
  balance: string;
  existentialDeposit: string;
  isSufficient: boolean;
  type: AssetType;
  tradable?: number;
}

export interface IPersistentOmniPoolToken extends PersistentAsset {
  id: string;
  decimals: number;
  balance: string;
  tradable?: number;
  hubReserves: string;
  shares: string;
  cap: string;
  protocolShares: string;
}

export interface IPersistentPoolBase {
  address: string;
  id?: string;
  type: PoolType;
  tokens: IPersistentPoolToken[];
  maxInRatio: number;
  maxOutRatio: number;
  minTradingLimit: number;
}

export interface IPersistentLbpPoolBase {
  id?: string;
  address: string;
  type: PoolType;
  tokens: IPersistentPoolToken[];
  maxInRatio: number;
  maxOutRatio: number;
  minTradingLimit: number;
  fee: number[];
  repayFeeApply: boolean;
  start: number;
  end: number;
  initialWeight: number;
  finalWeight: number;
  repayTarget: string;
  feeCollector: string;
  relayBlockNumber: number;
}

export interface IPersistentStableSwapBase {
  id: string;
  address: string;
  type: PoolType;
  tokens: IPersistentPoolToken[];
  maxInRatio: number;
  maxOutRatio: number;
  minTradingLimit: number;
  initialAmplification: number;
  finalAmplification: number;
  initialBlock: number;
  finalBlock: number;
  blockNumber: number;
  fee: number;
  totalIssuance: string;
}

export interface IPersistentOmniPoolBase {
  address: string;
  type: PoolType;
  tokens: IPersistentOmniPoolToken[];
  maxInRatio: number;
  maxOutRatio: number;
  minTradingLimit: number;
  hubAssetId: string;
}

export interface IPersistentDataInput {
  assets: PersistentAsset[];
  pools: {
    lbp: IPersistentLbpPoolBase[];
    xyk: IPersistentPoolBase[];
    stableswap: IPersistentStableSwapBase[];
    omni: IPersistentOmniPoolBase[];
    aave: IPersistentPoolBase[];
  };
}

export interface IOfflinePoolServiceDataSource {
  assets: Asset[];
  pools: {
    lbp: LbpPoolBase[];
    xyk: PoolBase[];
    stableswap: StableSwapBase[];
    omni: OmniPoolBase[];
    aave: PoolBase[];
  };
}

class OfflinePoolServiceUtils {
  private static readonly MAX_FINAL_WEIGHT = scale(bnum(100), 6);

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

  protected static decoratePoolType(src: string): PoolType {
    if (!src) throw new Error('Pool type can not be empty');

    switch (src) {
      case 'aave':
      case 'Aave':
      case 'AAVE':
        return PoolType.Aave;
      case 'xyk':
      case 'Xyk':
      case 'XYK':
        return PoolType.XYK;
      case 'lbp':
      case 'Lbp':
      case 'LBP':
        return PoolType.LBP;
      case 'stable':
      case 'Stable':
      case 'STABLE':
      case 'Stableswap':
        return PoolType.Stable;
      case 'omni':
      case 'Omni':
      case 'OMNI':
      case 'Omnipool':
        return PoolType.Omni;
      default:
        throw new Error(`Unknown pool type: ${src}`);
    }
  }

  protected static decorateAssetsPersistentData(
    src: PersistentAsset[] = []
  ): Asset[] {
    return src.map((pAsset) => {
      const {
        id,
        decimals,
        existentialDeposit,
        type,
        isSufficient,
        symbol,
        name,
        icon,
        location,
      } = pAsset;
      // TODO add values validation
      return {
        id,
        decimals,
        existentialDeposit,
        type,
        isSufficient,
        location,
        symbol: symbol ?? '',
        name: name ?? '',
        icon: icon ?? '',
      };
    });
  }

  protected static decorateBasePoolToken(src: IPersistentPoolToken): PoolToken {
    if (!src) throw new Error('Pool token can not be empty');

    const {
      id,
      decimals,
      symbol,
      balance,
      tradeable,
      tradable,
      name,
      existentialDeposit,
      type,
      isSufficient,
      icon,
      location,
      isWhiteListed,
    } = src;

    // TODO add values validation

    return {
      id,
      decimals,
      symbol,
      balance,
      tradeable: tradeable ?? tradable,
      name: name ?? '',
      existentialDeposit,
      type,
      isSufficient,
      icon: icon ?? '',
      location,
      isWhiteListed,
    };
  }

  protected static decorateOmniPoolToken(
    src: IPersistentOmniPoolToken
  ): OmniPoolToken {
    if (!src) throw new Error('Pool token can not be empty');

    const {
      id,
      decimals,
      symbol,
      balance,
      tradable,
      hubReserves,
      shares,
      cap,
      protocolShares,
      name,
      existentialDeposit,
      type,
      isSufficient,
      icon,
      location,
      isWhiteListed,
    } = src;

    // TODO add values validation

    return {
      tradeable: tradable,
      hubReserves: BigNumber(hubReserves),
      shares: BigNumber(shares),
      cap: BigNumber(cap),
      protocolShares: BigNumber(protocolShares),
      id,
      decimals,
      symbol,
      balance,
      name: name ?? '',
      existentialDeposit,
      type,
      isSufficient,
      icon: icon ?? '',
      location,
      isWhiteListed,
    };
  }

  protected static decorateBasePoolPersistentData(
    src: IPersistentPoolBase
  ): PoolBase {
    if (!src) throw new Error('Pool can not be empty');

    const {
      address,
      id,
      type,
      tokens,
      maxInRatio,
      maxOutRatio,
      minTradingLimit,
    } = src;

    // TODO add values validation

    return {
      id,
      address,
      type: OfflinePoolService.decoratePoolType(type),
      tokens: tokens.map(OfflinePoolService.decorateBasePoolToken),
      maxInRatio,
      maxOutRatio,
      minTradingLimit,
    };
  }

  protected static decorateLbpPoolPersistentData(
    src: IPersistentLbpPoolBase
  ): LbpPoolBase {
    if (!src) throw new Error('Pool can not be empty');

    const basePoolData = OfflinePoolService.decorateBasePoolPersistentData(src);

    // TODO check for active pool https://github.com/mckrava/hydration-sdk/blob/9f061a0680c9732216c82a2ea7e6bb7cbac5fba4/packages/sdk/src/pool/lbp/LbpPoolClient.ts#L34

    const {
      start,
      end,
      tokens,
      initialWeight,
      finalWeight,
      repayTarget,
      feeCollector,
      relayBlockNumber,
    } = src;

    const lbpPoolData: LbpPoolBase = {
      ...basePoolData,
      fee: src.fee as PoolFee,
      repayFeeApply: src.repayFeeApply, //TODO check implementation https://github.com/mckrava/hydration-sdk/blob/9f061a0680c9732216c82a2ea7e6bb7cbac5fba4/packages/sdk/src/pool/lbp/LbpPoolClient.ts#L137
    };

    const linearWeight = LbpMath.calculateLinearWeights(
      start.toString(),
      end.toString(),
      initialWeight.toString(),
      finalWeight.toString(),
      relayBlockNumber.toString()
    );

    const [accumulated, distributed] = tokens;
    const accumulatedAsset = accumulated.id.toString();
    const accumulatedWeight = bnum(linearWeight);
    const distributedAsset = distributed.id.toString();
    const distributedWeight = this.MAX_FINAL_WEIGHT.minus(
      bnum(accumulatedWeight)
    );

    lbpPoolData.tokens = [
      {
        id: accumulatedAsset,
        weight: accumulatedWeight,
        balance: accumulated.balance.toString(),
      } as WeightedPoolToken,
      {
        id: distributedAsset,
        weight: distributedWeight,
        balance: distributed.balance.toString(),
      } as WeightedPoolToken,
    ];

    return lbpPoolData;
  }

  protected static decorateStableswapPersistentData(
    src: IPersistentStableSwapBase
  ): StableSwapBase {
    if (!src) throw new Error('Pool can not be empty');

    const { address, type, tokens, maxInRatio, maxOutRatio, minTradingLimit } =
      OfflinePoolService.decorateBasePoolPersistentData(src);

    const {
      id,
      initialAmplification,
      finalAmplification,
      initialBlock,
      finalBlock,
      blockNumber,
      fee,
      totalIssuance,
    } = src;

    const amplification = StableMath.calculateAmplification(
      initialAmplification.toString(),
      finalAmplification.toString(),
      initialBlock.toString(),
      finalBlock.toString(),
      blockNumber.toString()
    );

    const stableSwapData: StableSwapBase = {
      id,
      address,
      type,
      fee: toPoolFee(src.fee),
      maxInRatio,
      maxOutRatio,
      minTradingLimit,
      amplification,
      totalIssuance,
      tokens,
      ...OfflinePoolService.getPoolDefaultPegs({
        poolFee: fee,
        assets: tokens,
      }),
    };

    return stableSwapData;
  }
  protected static decorateOmniPoolPersistentData(
    src: IPersistentOmniPoolBase
  ): OmniPoolBase {
    if (!src) throw new Error('Pool can not be empty');

    const { tokens, hubAssetId } = src;

    const basePoolData = OfflinePoolService.decorateBasePoolPersistentData(src);

    const omniPoolData: OmniPoolBase = {
      ...basePoolData,
      hubAssetId,
      tokens: tokens.map(OfflinePoolService.decorateOmniPoolToken),
    };

    return omniPoolData;
  }
}

export class OfflinePoolService
  extends OfflinePoolServiceUtils
  implements IPoolService
{
  // protected readonly api: ApiPromise;

  // protected readonly assetClient: AssetClient;
  //
  // protected readonly aaveClient: AavePoolClient;
  // protected readonly xykClient: XykPoolClient;
  // protected readonly omniClient: OmniPoolClient;
  // protected readonly lbpClient: LbpPoolClient;
  // protected readonly stableClient: StableSwapClient;
  //
  // protected readonly clients: PoolClient[] = [];

  protected onChainAssets: Asset[] = [];

  protected aavePools: PoolBase[] = [];
  protected xykPools: PoolBase[] = [];
  protected lbpPools: LbpPoolBase[] = [];
  protected omniPools: OmniPoolBase[] = [];
  protected stableswapPools: StableSwapBase[] = [];

  protected pools: Partial<Record<PoolType, PoolBase[]>> = {};

  private memRegistry = memoize1((mem: number) => {
    // this.log(`Registry mem ${mem} sync`); // TODO reimplement
    return this.syncRegistry();
  });

  static fromPersistentDataToDataSource(
    persistentData: IPersistentDataInput
  ): IOfflinePoolServiceDataSource {
    if (!persistentData.assets || persistentData.assets.length == 0)
      throw new Error('Assets list can not be empty');

    const dataSource: IOfflinePoolServiceDataSource = {
      assets: [],
      pools: {
        lbp: [],
        xyk: [],
        stableswap: [],
        omni: [],
        aave: [],
      },
    };

    //TODO decorate assets here

    if (!persistentData.pools) return dataSource;

    return {
      assets: OfflinePoolService.decorateAssetsPersistentData(
        persistentData.assets
      ),
      pools: {
        lbp: (persistentData.pools.lbp || []).map(
          OfflinePoolService.decorateLbpPoolPersistentData
        ),
        xyk: (persistentData.pools.xyk || []).map(
          OfflinePoolService.decorateBasePoolPersistentData
        ),
        stableswap: (persistentData.pools.stableswap || []).map(
          OfflinePoolService.decorateStableswapPersistentData
        ),
        omni: (persistentData.pools.omni || []).map(
          OfflinePoolService.decorateOmniPoolPersistentData
        ),
        aave: (persistentData.pools.aave || []).map(
          OfflinePoolService.decorateBasePoolPersistentData
        ),
      },
    };
  }

  constructor(dataSource: IOfflinePoolServiceDataSource) {
    super();
    // this.api = api;
    // this.assetClient = new AssetClient(this.api);
    // this.aaveClient = new AavePoolClient(this.api);
    // this.xykClient = new XykPoolClient(this.api);
    // this.omniClient = new OmniPoolClient(this.api);
    // this.lbpClient = new LbpPoolClient(this.api);
    // this.stableClient = new StableSwapClient(this.api);
    // this.clients = [
    //   this.aaveClient,
    //   this.xykClient,
    //   this.omniClient,
    //   this.lbpClient,
    //   this.stableClient,
    // ];

    this.onChainAssets = dataSource.assets;
    this.aavePools = dataSource.pools.aave;
    this.xykPools = dataSource.pools.xyk;
    this.lbpPools = dataSource.pools.lbp;
    this.omniPools = dataSource.pools.omni;
    this.stableswapPools = dataSource.pools.stableswap;
    this.pools = {
      [PoolType.Aave]: this.aavePools,
      [PoolType.XYK]: this.xykPools,
      [PoolType.LBP]: this.lbpPools,
      [PoolType.Omni]: this.omniPools,
      [PoolType.Stable]: this.stableswapPools,
    };
  }

  get assets(): Asset[] {
    return this.onChainAssets;
  }

  get isRegistrySynced(): boolean {
    return this.onChainAssets.length > 0;
  }

  async syncRegistry(external?: ExternalAsset[]) {
    // TODO reimplement - get assets list from datasource
    // const assets = await this.assetClient.getOnChainAssets(false, external);
    // this.clients.forEach((c) => c.withAssets(assets));
    // this.onChainAssets = assets;
  }

  async getPools(includeOnly: PoolType[]): Promise<PoolBase[]> {
    if (includeOnly.length == 0) {
      return Object.values(this.pools).flat().filter(Boolean);
    }

    return includeOnly.reduce((acc, poolType) => {
      const poolsOfType = this.pools[poolType] ?? [];
      return [...acc, ...poolsOfType];
    }, [] as PoolBase[]);
  }

  unsubscribe() {
    throw Error(
      'Method is not allowed for OfflinePool Service. Use PoolService instead.'
    );
  }

  async getPoolFees(poolPair: PoolPair, pool: Pool): Promise<PoolFees> {
    switch (pool.type) {
      // case PoolType.Aave:
      //   return this.aaveClient.getPoolFees(poolPair, pool.address);
      // case PoolType.XYK:
      //   return this.xykClient.getPoolFees(poolPair, pool.address);
      // case PoolType.Omni:
      //   return this.omniClient.getPoolFees(poolPair, pool.address);
      // case PoolType.LBP:
      //   return this.lbpClient.getPoolFees(poolPair, pool.address);
      // case PoolType.Stable:
      //   return this.stableClient.getPoolFees(poolPair, pool.address);
      default:
        throw new PoolNotFound(pool.type);
    }
  }

  private isDirectOmnipoolTrade(route: Hop[]) {
    return route.length == 1 && route[0].pool == PoolType.Omni;
  }

  buildBuyTx(
    assetIn: string,
    assetOut: string,
    amountOut: BigNumber,
    maxAmountIn: BigNumber,
    route: Hop[]
  ): Transaction {
    throw Error(
      'Method is not allowed for OfflinePoolService. Use PoolService instead.'
    );
  }

  buildSellTx(
    assetIn: string,
    assetOut: string,
    amountIn: BigNumber,
    minAmountOut: BigNumber,
    route: Hop[]
  ): Transaction {
    throw Error(
      'Method is not allowed for OfflinePoolService. Use PoolService instead.'
    );
  }
}
