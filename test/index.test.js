import test from 'ava'

import parse, {tokenize} from '../lib'

import utils from './_utils'

test('arithmetic tokens are lexed', (t) => {
  const result = tokenize('42 + 43')
  // utils.logResults(result)
  t.is(result[0].value, 42)
  t.is(result[1].value, '+')
  t.is(result[2].value, 43)
  t.is(result[3].type.label, 'eof')
})

test.failing('arithmetic ast is parsed', (t) => {
  const result = parse('42 + 43')
  // utils.logResults(result)
  t.deepEqual(result, {
    type: 'BinaryExpression',
    start: 0,
    end: 7,
    loc: {
      start: {
        line: 1,
        column: 0
      },
      end: {
        line: 1,
        column: 7
      }
    },
    left: {
      type: 'NumericLiteral',
      start: 0,
      end: 2,
      loc: {
        start: {
          line: 1,
          column: 0
        },
        end: {
          line: 1,
          column: 2
        }
      },
      extra: {
        rawValue: 42,
        raw: '42'
      },
      value: 42
    },
    operator: '+',
    right: {
      type: 'NumericLiteral',
      start: 5,
      end: 7,
      loc: {
        start: {
          line: 1,
          column: 5
        },
        end: {
          line: 1,
          column: 7
        }
      },
      extra: {
        rawValue: 43,
        raw: '43'
      },
      value: 43
    }
  })
})
