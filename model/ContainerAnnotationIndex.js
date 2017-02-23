import isString from '../util/isString'
import filter from '../util/filter'
import map from '../util/map'
import TreeIndex from '../util/TreeIndex'
import DocumentIndex from './DocumentIndex'

class ContainerAnnotationIndex extends DocumentIndex {

  constructor() {
    super()
    this.annosById = new TreeIndex()
    this.anchorsByPath = new TreeIndex.Arrays()
  }

  select(node) {
    return Boolean(node._isContainerAnnotation)
  }

  reset(data) {
    this.annosById.clear()
    this.anchorsByPath.clear()
    this._initialize(data)
  }

  get(containerId, type) {
    var annotations = map(this.annosById.get(containerId))
    if (isString(type)) {
      annotations = filter(annotations, DocumentIndex.filterByType)
    }
    return annotations
  }

  getAnchorsForPath(path) {
    return this.anchorsByPath.get(path) || []
  }

  create(anno) {
    this.annosById.set([anno.containerId, anno.id], anno)
    this.anchorsByPath.add(anno.start.path, anno.start)
    this.anchorsByPath.add(anno.end.path, anno.end)
  }

  delete(anno) {
    this.annosById.delete([anno.containerId, anno.id])
    this.anchorsByPath.remove(anno.start.path, anno.start)
    this.anchorsByPath.remove(anno.end.path, anno.end)
  }

  update(anno, path, newValue, oldValue) {
    // TODO: we need to change this when switching to coordinate ops
    if (this.select(anno)) {
      const coor = path[1]
      const prop = path[2]
      if ((coor === 'start' || coor === 'end') && prop === 'path') {
        this.anchorsByPath.remove(oldValue, anno[coor])
        this.anchorsByPath.add(newValue, anno[coor])
      }
    }
  }

}

export default ContainerAnnotationIndex
