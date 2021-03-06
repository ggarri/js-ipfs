/* eslint-env mocha */
'use strict'

const { expect } = require('interface-ipfs-core/src/utils/mocha')
const delay = require('delay')
const parallel = require('async/parallel')
const pull = require('pull-stream')
const pullThrough = require('pull-stream/throughs/through')
const pullAsyncMap = require('pull-stream/throughs/async-map')
const pullCollect = require('pull-stream/sinks/collect')
const pullValues = require('pull-stream/sources/values')
const GCLock = require('../../src/core/components/pin/gc-lock')

const promiseTakeLock = (type, lock, out, id, duration) => {
  return (cb) => {
    lock[type + 'Lock']()
      .then(async (release) => {
        try {
          out.push(`${type} ${id} start`)

          await delay(duration)

          out.push(`${type} ${id} end`)
        } finally {
          release()
        }
      })
      .then(() => cb())
  }
}
const promiseReadLock = (lock, out, id, duration) => {
  return promiseTakeLock('read', lock, out, id, duration)
}
const promiseWriteLock = (lock, out, id, duration) => {
  return promiseTakeLock('write', lock, out, id, duration)
}
const promiseTakeLockError = (type, lock, out, errs, id, duration) => {
  return (cb) => {
    lock[type + 'Lock']()
      .then(async (release) => {
        try {
          out.push(`${type} ${id} start`)

          await delay(duration)

          out.push(`${type} ${id} error`)

          const err = new Error('err')
          errs.push(err)

          throw err
        } finally {
          release()
        }
      })
      .catch(() => cb())
  }
}
const promiseReadLockError = (lock, out, errs, id, duration) => {
  return promiseTakeLockError('read', lock, out, errs, id, duration)
}
const promiseWriteLockError = (lock, out, errs, id, duration) => {
  return promiseTakeLockError('write', lock, out, errs, id, duration)
}

const pullTakeLock = (type, lock, out, id, duration) => {
  const lockFn = type === 'read' ? 'pullReadLock' : 'pullWriteLock'
  const vals = ['a', 'b', 'c']
  return (cb) => {
    pull(
      pullValues(vals),
      lock[lockFn](() => {
        let started = false
        return pull(
          pullThrough((i) => {
            if (!started) {
              out.push(`${type} ${id} start`)
              started = true
            }
          }),
          pullAsyncMap((i, cb) => {
            setTimeout(() => cb(null, i), duration / vals.length)
          })
        )
      }),
      pullCollect(() => {
        out.push(`${type} ${id} end`)
        cb()
      })
    )
  }
}
const pullReadLock = (lock, out, id, duration) => {
  return pullTakeLock('read', lock, out, id, duration)
}
const pullWriteLock = (lock, out, id, duration) => {
  return pullTakeLock('write', lock, out, id, duration)
}
const pullTakeLockError = (type, lock, out, errs, id, duration) => {
  const lockFn = type === 'read' ? 'pullReadLock' : 'pullWriteLock'
  const vals = ['a', 'b', 'c']
  return (cb) => {
    pull(
      pullValues(vals),
      lock[lockFn](() => {
        let started = false
        return pull(
          pullThrough((i) => {
            if (!started) {
              out.push(`${type} ${id} start`)
              started = true
            }
          }),
          pullAsyncMap((i, cb) => {
            setTimeout(() => cb(new Error('err')), duration)
          })
        )
      }),
      pullCollect((err) => {
        out.push(`${type} ${id} error`)
        errs.push(err)
        cb()
      })
    )
  }
}
const pullReadLockError = (lock, out, errs, id, duration) => {
  return pullTakeLockError('read', lock, out, errs, id, duration)
}
const pullWriteLockError = (lock, out, errs, id, duration) => {
  return pullTakeLockError('write', lock, out, errs, id, duration)
}

const expectResult = (out, exp, errs, expErrCount, done) => {
  if (typeof errs === 'function') {
    done = errs
  }
  return () => {
    try {
      expect(out).to.eql(exp)
      if (typeof expErrCount === 'number') {
        expect(errs.length).to.eql(expErrCount)
        for (const e of errs) {
          expect(e.message).to.eql('err')
        }
      }
    } catch (err) {
      return done(err)
    }
    done()
  }
}

const runTests = (suiteName, { readLock, writeLock, readLockError, writeLockError }) => {
  describe(suiteName, () => {
    it('multiple simultaneous reads', (done) => {
      const lock = new GCLock()
      const out = []
      parallel([
        readLock(lock, out, 1, 100),
        readLock(lock, out, 2, 200),
        readLock(lock, out, 3, 300)
      ], expectResult(out, [
        'read 1 start',
        'read 2 start',
        'read 3 start',
        'read 1 end',
        'read 2 end',
        'read 3 end'
      ], done))
    })

    it('multiple simultaneous writes', (done) => {
      const lock = new GCLock()
      const out = []
      parallel([
        writeLock(lock, out, 1, 100),
        writeLock(lock, out, 2, 200),
        writeLock(lock, out, 3, 300)
      ], expectResult(out, [
        'write 1 start',
        'write 1 end',
        'write 2 start',
        'write 2 end',
        'write 3 start',
        'write 3 end'
      ], done))
    })

    it('read then write then read', (done) => {
      const lock = new GCLock()
      const out = []
      parallel([
        readLock(lock, out, 1, 100),
        writeLock(lock, out, 1, 100),
        readLock(lock, out, 2, 100)
      ], expectResult(out, [
        'read 1 start',
        'read 1 end',
        'write 1 start',
        'write 1 end',
        'read 2 start',
        'read 2 end'
      ], done))
    })

    it('write then read then write', (done) => {
      const lock = new GCLock()
      const out = []
      parallel([
        writeLock(lock, out, 1, 100),
        readLock(lock, out, 1, 100),
        writeLock(lock, out, 2, 100)
      ], expectResult(out, [
        'write 1 start',
        'write 1 end',
        'read 1 start',
        'read 1 end',
        'write 2 start',
        'write 2 end'
      ], done))
    })

    it('two simultaneous reads then write then read', (done) => {
      const lock = new GCLock()
      const out = []
      parallel([
        readLock(lock, out, 1, 100),
        readLock(lock, out, 2, 200),
        writeLock(lock, out, 1, 100),
        readLock(lock, out, 3, 100)
      ], expectResult(out, [
        'read 1 start',
        'read 2 start',
        'read 1 end',
        'read 2 end',
        'write 1 start',
        'write 1 end',
        'read 3 start',
        'read 3 end'
      ], done))
    })

    it('two simultaneous writes then read then write', (done) => {
      const lock = new GCLock()
      const out = []
      parallel([
        writeLock(lock, out, 1, 100),
        writeLock(lock, out, 2, 100),
        readLock(lock, out, 1, 100),
        writeLock(lock, out, 3, 100)
      ], expectResult(out, [
        'write 1 start',
        'write 1 end',
        'write 2 start',
        'write 2 end',
        'read 1 start',
        'read 1 end',
        'write 3 start',
        'write 3 end'
      ], done))
    })

    it('simultaneous reads with error then write', (done) => {
      const lock = new GCLock()
      const out = []
      const errs = []
      parallel([
        readLockError(lock, out, errs, 1, 100),
        readLock(lock, out, 2, 200),
        writeLock(lock, out, 1, 100)
      ], expectResult(out, [
        'read 1 start',
        'read 2 start',
        'read 1 error',
        'read 2 end',
        'write 1 start',
        'write 1 end'
      ], errs, 1, done))
    })

    it('simultaneous writes with error then read', (done) => {
      const lock = new GCLock()
      const out = []
      const errs = []
      parallel([
        writeLockError(lock, out, errs, 1, 100),
        writeLock(lock, out, 2, 100),
        readLock(lock, out, 1, 100)
      ], expectResult(out, [
        'write 1 start',
        'write 1 error',
        'write 2 start',
        'write 2 end',
        'read 1 start',
        'read 1 end'
      ], errs, 1, done))
    })
  })
}

describe('gc-lock', function () {
  runTests('promise style lock', {
    readLock: promiseReadLock,
    writeLock: promiseWriteLock,
    readLockError: promiseReadLockError,
    writeLockError: promiseWriteLockError
  })

  runTests('pull stream style lock', {
    readLock: pullReadLock,
    writeLock: pullWriteLock,
    readLockError: pullReadLockError,
    writeLockError: pullWriteLockError
  })
})
