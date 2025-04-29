import { ApiPromise } from '@polkadot/api';
import { CallDryRunEffects } from '@polkadot/types/interfaces';
import { SubmittableExtrinsic } from '@polkadot/api/promise/types';

import { memoize1 } from '@thi.ng/memoize';

import { AavePoolClient } from './aave/AavePoolClient';
import { LbpPoolClient } from './lbp/LbpPoolClient';
import { OmniPoolClient } from './omni/OmniPoolClient';
import { XykPoolClient } from './xyk/XykPoolClient';
import { StableSwapClient } from './stable/StableSwapClient';
import { buildRoute } from './PoolUtils';

import { AssetClient, PolkadotApiClient } from '../client';
import { PoolNotFound } from '../errors';
import {
  Asset,
  ExternalAsset,
  Hop,
  IPoolService,
  Pool,
  PoolBase,
  PoolFees,
  PoolPair,
  PoolType,
  Transaction,
} from '../types';
import { BigNumber } from '../utils/bignumber';

import { PoolClient } from './PoolClient';

export class PoolService extends PolkadotApiClient implements IPoolService {
  protected readonly api: ApiPromise;

  protected readonly assetClient: AssetClient;

  protected readonly aaveClient: AavePoolClient;
  protected readonly xykClient: XykPoolClient;
  protected readonly omniClient: OmniPoolClient;
  protected readonly lbpClient: LbpPoolClient;
  protected readonly stableClient: StableSwapClient;

  protected readonly clients: PoolClient[] = [];

  protected onChainAssets: Asset[] = [];

  private memRegistry = memoize1((mem: number) => {
    this.log(`Registry mem ${mem} sync`);
    return this.syncRegistry();
  });

  constructor(api: ApiPromise) {
    super(api);
    this.api = api;
    this.assetClient = new AssetClient(this.api);
    this.aaveClient = new AavePoolClient(this.api);
    this.xykClient = new XykPoolClient(this.api);
    this.omniClient = new OmniPoolClient(this.api);
    this.lbpClient = new LbpPoolClient(this.api);
    this.stableClient = new StableSwapClient(this.api);
    this.clients = [
      this.aaveClient,
      this.xykClient,
      this.omniClient,
      this.lbpClient,
      this.stableClient,
    ];
  }

  get assets(): Asset[] {
    return this.onChainAssets;
  }

  get isRegistrySynced(): boolean {
    return this.onChainAssets.length > 0;
  }

  async syncRegistry(external?: ExternalAsset[]) {
    const assets = await this.assetClient.getOnChainAssets(false, external);
    this.clients.forEach((c) => c.withAssets(assets));
    this.onChainAssets = assets;
  }

  async getPools(includeOnly: PoolType[]): Promise<PoolBase[]> {
    if (!this.isRegistrySynced) {
      await this.memRegistry(1);
    }

    if (includeOnly.length == 0) {
      const pools = await Promise.all(
        this.clients
          .filter((client) => client.isSupported())
          .map((client) => client.getPoolsMem())
      );
      return pools.flat();
    }

    const pools = await Promise.all(
      this.clients
        .filter((client) => includeOnly.some((t) => t === client.getPoolType()))
        .map((client) => client.getPoolsMem())
    );
    return pools.flat();
  }

  unsubscribe() {
    this.aaveClient.unsubscribe();
    this.xykClient.unsubscribe();
    this.omniClient.unsubscribe();
    this.lbpClient.unsubscribe();
    this.stableClient.unsubscribe();
  }

  async getPoolFees(poolPair: PoolPair, pool: Pool): Promise<PoolFees> {
    switch (pool.type) {
      case PoolType.Aave:
        return this.aaveClient.getPoolFees(poolPair, pool.address);
      case PoolType.XYK:
        return this.xykClient.getPoolFees(poolPair, pool.address);
      case PoolType.Omni:
        return this.omniClient.getPoolFees(poolPair, pool.address);
      case PoolType.LBP:
        return this.lbpClient.getPoolFees(poolPair, pool.address);
      case PoolType.Stable:
        return this.stableClient.getPoolFees(poolPair, pool.address);
      default:
        throw new PoolNotFound(pool.type);
    }
  }

  private isDirectOmnipoolTrade(route: Hop[]) {
    return route.length == 1 && route[0].pool == PoolType.Omni;
  }

  private async dryRun(
    account: string,
    extrinsic: SubmittableExtrinsic
  ): Promise<CallDryRunEffects> {
    let result;
    try {
      result = await this.api.call.dryRunApi.dryRunCall(
        {
          System: { Signed: account },
        },
        extrinsic.inner.toHex()
      );
    } catch (e) {
      console.error(e);
      throw new Error('Dry run execution failed!');
    }

    if (result.isOk) {
      return result.asOk;
    }
    console.log(result.asErr.toHuman());
    throw new Error('Dry run execution error!');
  }

  buildBuyTx(
    assetIn: string,
    assetOut: string,
    amountOut: BigNumber,
    maxAmountIn: BigNumber,
    route: Hop[]
  ): Transaction {
    let tx: SubmittableExtrinsic;

    // In case of direct trade in omnipool we skip router (cheaper tx)
    if (this.isDirectOmnipoolTrade(route)) {
      tx = this.api.tx.omnipool.buy(
        assetOut,
        assetIn,
        amountOut.toFixed(),
        maxAmountIn.toFixed()
      );
    } else {
      tx = this.api.tx.router.buy(
        assetIn,
        assetOut,
        amountOut.toFixed(),
        maxAmountIn.toFixed(),
        buildRoute(route)
      );
    }

    return {
      hex: tx.toHex(),
      name: 'RouterBuy',
      get: () => tx,
      dryRun: (account: string) => this.dryRun(account, tx),
    } as Transaction;
  }

  buildSellTx(
    assetIn: string,
    assetOut: string,
    amountIn: BigNumber,
    minAmountOut: BigNumber,
    route: Hop[]
  ): Transaction {
    let tx: SubmittableExtrinsic;

    // In case of direct trade in omnipool we skip router (cheaper tx)
    if (this.isDirectOmnipoolTrade(route)) {
      tx = this.api.tx.omnipool.sell(
        assetIn,
        assetOut,
        amountIn.toFixed(),
        minAmountOut.toFixed()
      );
    } else {
      tx = this.api.tx.router.sell(
        assetIn,
        assetOut,
        amountIn.toFixed(),
        minAmountOut.toFixed(),
        buildRoute(route)
      );
    }

    return {
      hex: tx.toHex(),
      name: 'RouterSell',
      get: () => tx,
      dryRun: (account: string) => this.dryRun(account, tx),
    } as Transaction;
  }

  buildSellAllTx(
    assetIn: string,
    assetOut: string,
    minAmountOut: BigNumber,
    route: Hop[]
  ): Transaction {
    const tx: SubmittableExtrinsic = this.api.tx.router.sellAll(
      assetIn,
      assetOut,
      minAmountOut.toFixed(),
      buildRoute(route)
    );

    return {
      hex: tx.toHex(),
      name: 'RouterSellAll',
      get: () => tx,
      dryRun: (account: string) => this.dryRun(account, tx),
    } as Transaction;
  }
}
