import isArray from '../../util/isArray'
import isNumber from '../../util/isNumber'
import isObject from '../../util/isObject'
import isString from '../../util/isString'
import EventEmitter from '../../util/EventEmitter'
import forEach from '../../util/forEach'
import NodeFactory from './NodeFactory'

/*
  A data storage implemention that supports data defined via a {@link Schema},
  and incremental updates which are backed by a OT library.

  It forms the underlying implementation for {@link Document}.
 */
class Data extends EventEmitter {

  /**
    @param {Schema} schema
    @param {Object} [options]
  */
  constructor(schema, options) {
    super()

    options = options || {}
    this.schema = schema
    this.nodes = {}
    this.indexes = {}
    this.options = options || {}

    this.nodeFactory = options.nodeFactory || new NodeFactory(schema.nodeRegistry)

    // Sometimes necessary to resolve issues with updating indexes in presence
    // of cyclic dependencies
    this.__QUEUE_INDEXING__ = false
    this.queue = []
  }

  /**
    Check if this storage contains a node with given id.

    @returns {bool} `true` if a node with id exists, `false` otherwise.
   */
  contains(id) {
    return Boolean(this.nodes[id])
  }

  /**
    Get a node or value via path.

    @param {String|String[]} path node id or path to property.
    @returns {Node|Object|Primitive|undefined} a Node instance, a value or undefined if not found.
   */
  get(path, strict) {
    let result
    let realPath = this.getRealPath(path)
    if (!realPath) {
      return undefined
    }
    result = this._get(realPath)
    if (strict && result === undefined) {
      if (isString(path)) {
        throw new Error("Could not find node with id '"+path+"'.")
      } else {
        throw new Error("Property for path '"+path+"' us undefined.")
      }
    }
    return result
  }

  _get(realPath) {
    let result
    if (isString(realPath)) {
      result = this.nodes[realPath]
    } else if (realPath.length === 1) {
      result = this.nodes[realPath[0]]
    } else if (realPath.length === 2) {
      result = this.nodes[realPath[0]][realPath[1]]
    } else if (realPath.length === 3) {
      result = this.nodes[realPath[0]][realPath[1]][realPath[2]]
    } else {
      throw new Error('Path of length '+realPath.length+' not supported.')
    }
    return result
  }

  getRealPath(path) {
    if (!path) return false
    if (isString(path)) return path
    if (path.length < 3) return path
    let nodeId = path[0]
    let realPath = [nodeId]
    let context = this.nodes[nodeId]
    let prop, name
    let L = path.length
    let i = 1
    for (; i<L-1; i++) {
      if (!context) return false
      name = path[i]
      prop = context[name]
      if (isArray(prop)) {
        let next = path[i+1]
        if (isNumber(next)) {
          realPath.push(name)
          context = prop
        }
        // EXPERIMENTAL: allow to use
        // a notation such as 'l1.items.li1.content'
        else {
          return this.getRealPath(path.slice(i+1))
        }
      } else if (isString(prop)) {
        context = this.nodes[prop]
        realPath = [prop]
      } else if (isObject(prop)) {
        realPath.push(name)
        context = prop
      } else {
        return false
      }
    }
    // the last one is always a property
    realPath.push(path[L-1])

    return realPath
  }

  /**
    Get the internal storage for nodes.

    @return The internal node storage.
   */
  getNodes() {
    return this.nodes
  }

  /**
    Create a node from the given data.

    @return {Node} The created node.
   */
  create(nodeData) {
    var node = this.nodeFactory.create(nodeData.type, nodeData)
    if (!node) {
      throw new Error('Illegal argument: could not create node for data:', nodeData)
    }
    if (this.contains(node.id)) {
      throw new Error("Node already exists: " + node.id)
    }
    if (!node.id || !node.type) {
      throw new Error("Node id and type are mandatory.")
    }
    this.nodes[node.id] = node

    var change = {
      type: 'create',
      node: node
    }

    if (this.__QUEUE_INDEXING__) {
      this.queue.push(change)
    } else {
      this._updateIndexes(change)
    }

    return node
  }

  /**
    Delete the node with given id.

    @param {String} nodeId
    @returns {Node} The deleted node.
   */
  delete(nodeId) {
    var node = this.nodes[nodeId]
    node.dispose()
    delete this.nodes[nodeId]

    var change = {
      type: 'delete',
      node: node,
    }

    if (this.__QUEUE_INDEXING__) {
      this.queue.push(change)
    } else {
      this._updateIndexes(change)
    }

    return node
  }

  /**
    Set a property to a new value.

    @param {Array} property path
    @param {Object} newValue
    @returns {Node} The deleted node.
   */
  set(path, newValue) {
    var realPath = this.getRealPath(path)
    if (!realPath) {
      console.error('Could not resolve path', path)
      return
    }
    let node = this.get(realPath[0])
    let oldValue = this._set(realPath, newValue)
    var change = {
      type: 'set',
      node: node,
      path: realPath,
      newValue: newValue,
      oldValue: oldValue
    }
    if (this.__QUEUE_INDEXING__) {
      this.queue.push(change)
    } else {
      this._updateIndexes(change)
    }
    return oldValue
  }

  _set(realPath, newValue) {
    let oldValue
    if (realPath.length === 2) {
      oldValue = this.nodes[realPath[0]][realPath[1]]
      this.nodes[realPath[0]][realPath[1]] = newValue
    } else if (realPath.length === 3) {
      oldValue = this.nodes[realPath[0]][realPath[1]][realPath[2]]
      this.nodes[realPath[0]][realPath[1]][realPath[2]] = newValue
    } else {
      throw new Error('Path of length '+realPath.length+' not supported.')
    }
    return oldValue
  }

  /**
    Update a property incrementally.

    @param {Array} property path
    @param {Object} diff
    @returns {any} The value before applying the update.
  */
  update(path, diff) {
    // TODO: do we really want this incremental implementation here?
    var realPath = this.getRealPath(path)
    if (!realPath) {
      console.error('Could not resolve path', path)
      return
    }
    let node = this.get(realPath[0])
    let oldValue = this._get(realPath)
    let newValue
    if (diff.isOperation) {
      newValue = diff.apply(oldValue)
    } else {
      diff = this._normalizeDiff(oldValue, diff)
      if (isString(oldValue)) {
        switch (diff.type) {
          case 'delete': {
            newValue = oldValue.split('').splice(diff.start, diff.end-diff.start).join('')
            break
          }
          case 'insert': {
            newValue = [oldValue.substring(0, diff.start), diff.text, oldValue.substring(diff.start)].join('')
            break
          }
          default:
            throw new Error('Unknown diff type')
        }
      } else if (isArray(oldValue)) {
        newValue = oldValue.slice(0)
        switch (diff.type) {
          case 'delete': {
            newValue.splice(diff.pos, 1)
            break
          }
          case 'insert': {
            newValue.splice(diff.pos, 0, diff.value)
            break
          }
          default:
            throw new Error('Unknown diff type')
        }
      } else if (oldValue._isCoordinate) {
        switch (diff.type) {
          case 'shift': {
            // ATTENTION: in this case we do not want to create a new value
            oldValue = { path: oldValue.path, offset: oldValue.offset }
            newValue = oldValue
            newValue.offset += diff.value
            break
          }
          default:
            throw new Error('Unknown diff type')
        }
      } else {
        throw new Error('Diff is not supported:', JSON.stringify(diff))
      }
    }
    this._set(realPath, newValue)

    var change = {
      type: 'update',
      node: node,
      path: realPath,
      newValue: newValue,
      oldValue: oldValue
    }

    if (this.__QUEUE_INDEXING__) {
      this.queue.push(change)
    } else {
      this._updateIndexes(change)
    }

    return oldValue
  }

  // normalize to support legacy formats
  _normalizeDiff(value, diff) {
    if (isString(value)) {
      // legacy
      if (diff['delete']) {
        console.warn('DEPRECATED: use doc.update(path, {type:"delete", start:s, end: e}) instead')
        diff = {
          type: 'delete',
          start: diff['delete'].start,
          end: diff['delete'].end
        }
      } else if (diff['insert']) {
        console.warn('DEPRECATED: use doc.update(path, {type:"insert", start:s, text: t}) instead')
        diff = {
          type: 'insert',
          start: diff['insert'].offset,
          text: diff['insert'].value
        }
      }
    } else if (isArray(value)) {
      // legacy
      if (diff['delete']) {
        console.warn('DEPRECATED: use doc.update(path, {type:"delete", pos:1}) instead')
        diff = {
          type: 'delete',
          pos: diff['delete'].offset
        }
      } else if (diff['insert']) {
        console.warn('DEPRECATED: use doc.update(path, {type:"insert", pos:1, value: "foo"}) instead')
        diff = {
          type: 'insert',
          pos: diff['insert'].offset,
          value: diff['insert'].value
        }
      }
    } else if (value._isCoordinate) {
      if (diff.hasOwnProperty('shift')) {
        console.warn('DEPRECATED: use doc.update(path, {type:"shift", value:2}) instead')
        diff = {
          type: 'shift',
          value: diff['shift']
        }
      }
    }
    return diff
  }

  /*
    DEPRECATED: We moved away from having JSON as first-class exchange format.
    We will remove this soon.

    @internal
    @deprecated
   */
  toJSON() {
    let nodes = {}
    forEach(this.nodes, (node)=>{
      nodes[node.id] = node.toJSON()
    })
    return {
      schema: [this.schema.id, this.schema.version],
      nodes: nodes
    }
  }

  /**
    Clear nodes.

    @internal
   */
  reset() {
    this.nodes.clear()
  }

  /**
    Add a node index.

    @param {String} name
    @param {NodeIndex} index
   */
  addIndex(name, index) {
    if (this.indexes[name]) {
      console.error('Index with name %s already exists.', name)
    }
    index.reset(this)
    this.indexes[name] = index
    return index
  }

  /**
    Get the node index with given name.

    @param {String} name
    @returns {NodeIndex} The node index.
   */
  getIndex(name) {
    return this.indexes[name]
  }

  /**
    Update a node index by providing of change object.

    @param {Object} change
   */
  _updateIndexes(change) {
    if (!change || this.__QUEUE_INDEXING__) return
    forEach(this.indexes, function(index) {
      if (index.select(change.node)) {
        if (!index[change.type]) {
          console.error('Contract: every NodeIndex must implement ' + change.type)
        }
        index[change.type](change.node, change.path, change.newValue, change.oldValue)
      }
    })
  }

  /**
    Stops indexing process, all changes will be collected in indexing queue.

    @private
  */
  _stopIndexing() {
    this.__QUEUE_INDEXING__ = true
  }

  /**
    Update all index changes from indexing queue.

    @private
  */
  _startIndexing() {
    this.__QUEUE_INDEXING__ = false
    while(this.queue.length >0) {
      var change = this.queue.shift()
      this._updateIndexes(change)
    }
  }

}

export default Data
