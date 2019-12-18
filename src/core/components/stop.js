'use strict'

const defer = require('p-defer')
const { NotStartedError, AlreadyInitializedError } = require('../errors')
const Components = require('./')

module.exports = ({
  apiManager,
  options: constructorOptions,
  bitswap,
  blockService,
  gcLock,
  initOptions,
  ipld,
  ipns,
  keychain,
  libp2p,
  peerInfo,
  pinManager,
  preload,
  print,
  repo
}) => async function stop () {
  const stopPromise = defer()
  const { cancel } = apiManager.update({ stop: () => stopPromise.promise })

  try {
    blockService.unsetExchange()
    bitswap.stop()
    preload.stop()

    await Promise.all([
      ipns.republisher.stop(),
      // mfsPreload.stop(),
      libp2p.stop(),
      repo.close()
    ])

    const api = createApi({
      apiManager,
      constructorOptions,
      blockService,
      gcLock,
      initOptions,
      ipld,
      keychain,
      peerInfo,
      pinManager,
      preload,
      print,
      repo
    })

    apiManager.update(api, () => { throw new NotStartedError() })
  } catch (err) {
    cancel()
    stopPromise.reject(err)
    throw err
  }

  stopPromise.resolve(apiManager.api)
  return apiManager.api
}

function createApi ({
  apiManager,
  constructorOptions,
  blockService,
  gcLock,
  initOptions,
  ipld,
  keychain,
  peerInfo,
  pinManager,
  preload,
  print,
  repo
}) {
  const dag = {
    get: Components.dag.get({ ipld, preload }),
    resolve: Components.dag.resolve({ ipld, preload }),
    tree: Components.dag.tree({ ipld, preload })
  }
  const object = {
    data: Components.object.data({ ipld, preload }),
    get: Components.object.get({ ipld, preload }),
    links: Components.object.links({ dag }),
    new: Components.object.new({ ipld, preload }),
    patch: {
      addLink: Components.object.patch.addLink({ ipld, gcLock, preload }),
      appendData: Components.object.patch.appendData({ ipld, gcLock, preload }),
      rmLink: Components.object.patch.rmLink({ ipld, gcLock, preload }),
      setData: Components.object.patch.setData({ ipld, gcLock, preload })
    },
    put: Components.object.put({ ipld, gcLock, preload }),
    stat: Components.object.stat({ ipld, preload })
  }
  const pin = {
    add: Components.pin.add({ pinManager, gcLock, dag, object }),
    ls: Components.pin.ls({ pinManager, object }),
    rm: Components.pin.rm({ pinManager, gcLock, object })
  }
  // FIXME: resolve this circular dependency
  dag.put = Components.dag.put({ ipld, pin, gcLock, preload })
  const add = Components.add({ ipld, dag, preload, pin, gcLock, options: constructorOptions })
  const refs = () => { throw new NotStartedError() }
  refs.local = Components.refs.local({ repo })

  const api = {
    add,
    block: {
      get: Components.block.get({ blockService, preload }),
      put: Components.block.put({ blockService, gcLock, preload }),
      rm: Components.block.rm({ blockService, gcLock, pinManager }),
      stat: Components.block.stat({ blockService, preload })
    },
    bootstrap: {
      add: Components.bootstrap.add({ repo }),
      list: Components.bootstrap.list({ repo }),
      rm: Components.bootstrap.rm({ repo })
    },
    cat: Components.cat({ ipld, preload }),
    config: Components.config({ repo }),
    dns: Components.dns(),
    files: Components.files({ ipld, blockService, repo, preload, options: constructorOptions }),
    get: Components.get({ ipld, preload }),
    id: Components.id({ peerInfo }),
    init: () => { throw new AlreadyInitializedError() },
    isOnline: Components.isOnline({}),
    ls: Components.ls({ ipld, preload }),
    object,
    pin,
    refs,
    repo: {
      // TODO: gc should be available when stopped
      // `resolve` (passed to `refs` API) which is a dependency for `gc` API
      // needs to be altered to allow `name` API dependency to be optional, so
      // that `resolve` can also be available when not started, and so `gc` can
      // be run when not started.
      // gc: Commands.repo.gc({ gcLock, pin, pinManager, refs, repo }),
      stat: Components.repo.stat({ repo }),
      version: Components.repo.version({ repo })
    },
    start: Components.start({
      apiManager,
      options: constructorOptions,
      blockService,
      gcLock,
      initOptions,
      ipld,
      keychain,
      peerInfo,
      pinManager,
      preload,
      print,
      repo
    }),
    stats: {
      bitswap: () => { throw new NotStartedError() },
      bw: () => { throw new NotStartedError() },
      repo: Components.repo.stat({ repo })
    },
    stop: () => apiManager.api,
    swarm: {
      addrs: () => { throw new NotStartedError() },
      connect: () => { throw new NotStartedError() },
      disconnect: () => { throw new NotStartedError() },
      localAddrs: Components.swarm.localAddrs({ peerInfo }),
      peers: () => { throw new NotStartedError() }
    },
    version: Components.version({ repo })
  }

  return api
}
