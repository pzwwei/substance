import { module } from 'substance-test'
import Fragmenter from '../model/Fragmenter'
import Annotation from '../model/Annotation'

const test = module('Fragmenter')

var TEXT = 'ABCDEFGHI'

test("No annos.", function(t) {
  var annos = []
  var html = _render(TEXT, annos)
  t.equal(html, TEXT)
  t.end()
})

test("With one anno.", function(t) {
  var annos = [_anno('b', 'b1', 3, 6)]
  var html = _render(TEXT, annos)
  t.equal(html, 'ABC<b>DEF</b>GHI')
  t.end()
})

test("With one anchor.", function(t) {
  var annos = [_anno('a', 'a1', 3, 3, {
    isAnchor: true
  })]
  var html = _render(TEXT, annos)
  t.equal(html, 'ABC<a></a>DEFGHI')
  t.end()
})

test("With one inline.", function(t) {
  var annos = [_anno('i', 'i1', 3, 4)]
  var html = _render(TEXT, annos)
  t.equal(html, 'ABC<i>D</i>EFGHI')
  t.end()
})

test("One nested anno.", function(t) {
  var annos = [_anno('b', 'b1', 3, 6), _anno('i', 'i1', 4, 5)]
  var html = _render(TEXT, annos)
  t.equal(html, 'ABC<b>D<i>E</i>F</b>GHI')
  t.end()
})

test("Overlapping annos.", function(t) {
  var annos = [_anno('b', 'b1', 3, 6), _anno('i', 'i1', 4, 8)]
  var html = _render(TEXT, annos)
  t.equal(html, 'ABC<b>D<i>EF</i></b><i>GH</i>I')
  t.end()
})

test("Equal annos.", function(t) {
  var annos = [_anno('b', 'b1', 3, 6), _anno('i', 'i1', 3, 6)]
  var html = _render(TEXT, annos)
  t.equal(html, 'ABC<b><i>DEF</i></b>GHI')
  t.end()
})

test("Overlapping with fragmentation hint.", function(t) {
  var annos = [
    _anno('b', 'b1', 3, 6),
    _anno('a', 'link1', 4, 8, {
      fragmentation: Fragmenter.SHOULD_NOT_SPLIT
    })
  ]
  var html = _render(TEXT, annos)
  t.equal(html, 'ABC<b>D</b><a><b>EF</b>GH</a>I')
  t.end()
})

test("Anchors should rendered as early as possible.", function(t) {
  var annos = [
    _anno('b', 'b1', 3, 6),
    _anno('a', 'a1', 3, 3, {
      isAnchor: true
    })
  ]
  var html = _render(TEXT, annos)
  t.equal(html, 'ABC<a></a><b>DEF</b>GHI')
  t.end()
})


test("Two subsequent inline nodes.", function(t) {
  var annos = [
    _anno('a', 'inline1', 3, 4, {
      isInline: true
    }),
    _anno('b', 'inline2', 4, 5, {
      isInline: true
    })
  ]
  var html = _render(TEXT, annos)
  t.equal(html, 'ABC<a>D</a><b>E</b>FGHI')
  t.end()
})

test("Collapsed annotation.", function(t) {
  var annos = [
    _anno('a', 'a1', 0, 0, {
    })
  ]
  var html = _render(TEXT, annos)
  t.equal(html, '<a></a>ABCDEFGHI')
  t.end()
})

test("Two collapsed annotations.", function(t) {
  var annos = [
    _anno('a', 'a1', 0, 0, {
    }),
    _anno('b', 'b2', 0, 0, {
    })
  ]
  var html = _render(TEXT, annos)
  t.equal(html, '<a></a><b></b>ABCDEFGHI')
  t.end()
})

test("Anchors should not fragment other annotations.", function(t) {
  var annos = [
    _anno('a', 'a1', 3, 6),
    _anno('b', 'b1', 4, 4, {
      isAnchor: true
    })
  ]
  var html = _render(TEXT, annos)
  t.equal(html, 'ABC<a>D<b></b>EF</a>GHI')
  t.end()
})

function _anno(tagName, id, startOffset, endOffset, opts = {}) {
  class AnonymousAnno extends Anno {}
  if (opts.hasOwnProperty('fragmentation')) {
    AnonymousAnno.fragmentation = opts.fragmentation
  }
  let anno = new AnonymousAnno(tagName, id, startOffset, endOffset)
  if (opts.hasOwnProperty('isAnchor')) {
    anno._isAnchor = opts.isAnchor
    anno.zeroWidth = true
    anno.offset = startOffset
  }
  if (opts.hasOwnProperty('isInline')) {
    anno._isInline = opts.isInline
  }
  return anno
}

class Anno extends Annotation {

  constructor(tagName, id, startOffset, endOffset) {
    super(null, {
      id: id,
      start: { path: [id, 'content'], offset: startOffset},
      end: { path: [id, 'content'], offset: endOffset }
    })

    this.tagName = tagName

    this._isAnchor = false
    this._isInline = false
  }

  // anchors are special annotations that have zero width
  isAnchor() {
    return this._isAnchor
  }

  // inline nodes are implementated as annotations bound to a single character
  // I.e. the always have a length of 1
  isInline() {
    return this._isInline
  }

}

function _render(text, annotations, opts) {
  opts = opts || {}
  var output = []
  var fragmenter = new Fragmenter()
  fragmenter.onText = function(context, text) {
    output.push(text)
  }
  fragmenter.onEnter = function(fragment) {
    var node = fragment.node
    if (opts.withId) {
      output.push('<' + node.tagName + ' id="' + node.id +'">')
    } else {
      output.push('<' + node.tagName + '>')
    }
  }
  fragmenter.onExit = function(fragment) {
    var node = fragment.node
    output.push('</' + node.tagName + '>')
  }
  fragmenter.start(output, text, annotations)
  return output.join('')
}
