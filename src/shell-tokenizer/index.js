/* eslint max-len: 0 */
/* eslint indent: 0 */

// TODO: rename this file to "shell-tokenizer"

import type {TokenType} from './types';

import {isIdentifierStart, isIdentifierChar} from '../util/identifier';
// eslint-disable-next-line no-duplicate-imports
import {types as tt, keywords as keywordTypes} from './types';
import {lineBreak, nonASCIIwhitespace} from '../util/whitespace';

// Object type used to represent tokens. Note that normally, tokens
// simply exist as properties on the parser's state object. This is only
// used for the external tokenizer.

export class Token {
  constructor(state) {
    this.type = state.type;
    this.value = state.value;

    this.start = state.start;
    this.end = state.end;

    this.startLine = state.startLine;
    this.startColumn = state.startColumn;
    this.endLine = state.endLine;
    this.endColumn = state.endColumn;
  }

  type: TokenType;
  value: any;
  start: number;
  end: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

// ## Tokenizer

function codePointToString(code) {
  // UTF-16 Decoding
  if (code <= 0xFFFF) {
    return String.fromCharCode(code);
  }
  return String.fromCharCode(((code - 0x10000) >> 10) + 0xD800, ((code - 0x10000) & 1023) + 0xDC00);
}

export class TokenizerState {
  constructor() {
    this.pos = 0;
    this.curLine = 1;
    this.curColumn = 0;

    this.start = this.end =
    this.lastTokStart = this.lastTokEnd =
    this.pos;

    this.startLine = this.endLine =
    this.lastTokStartLine = this.lastTokEndLine =
    this.curLine;

    this.startColumn = this.endColumn =
    this.lastTokStartColumn = this.lastTokEndColumn =
    this.curColumn;
  }
}

export default class Tokenizer {
  constructor(options, input) {
    this.options = options;
    this.input = input;
    this.state = new TokenizerState();
  }

  // Yield the next token

  next() {
    if (this.done) return {done: true, value: undefined};

    this.state.lastTokEnd = this.state.end;
    this.state.lastTokStart = this.state.start;
    this.state.lastTokEndLine = this.state.endLine;
    this.state.lastTokEndColumn = this.state.endColumn;
    this.state.lastTokStartLine = this.state.startLine;
    this.state.lastTokStartColumn = this.state.startColumn;

    this.nextToken();
    return {done: false, value: this.state};
  }

  [Symbol.iterator]() {
    return this;
  }

  // Read a single token, updating the parser object's token-related
  // properties.

  nextToken() {
    this.skipSpace();

    this.state.start = this.state.pos;
    this.state.startLine = this.state.curLine;
    this.state.startColumn = this.state.curColumn;
    if (this.state.pos >= this.input.length) {
      this.done = true;
      return this.finishToken(tt.eof);
    }

    return this.readToken(this.fullCharCodeAtPos());
  }

  readToken(code) {
    // Identifier or keyword. '\uXXXX' sequences are allowed in
    // identifiers, so '\' also dispatches to that.
    if (isIdentifierStart(code)) {
      return this.readWord();
    }
    return this.getTokenFromCode(code);
  }

  fullCharCodeAtPos() {
    const code = this.input.charCodeAt(this.state.pos);
    if (code <= 0xd7ff || code >= 0xe000) return code;

    const next = this.input.charCodeAt(this.state.pos + 1);
    return (code << 10) + next - 0x35fdc00;
  }

  // Called at the start of the parse and after every token. Skips
  // whitespace and comments, and.

  skipSpace() {
    loop: while (this.state.pos < this.input.length) {
      const ch = this.input.charCodeAt(this.state.pos);
      switch (ch) {
        case 32: case 160: // ' '
          ++this.state.pos;
          break;

        case 13:
          if (this.input.charCodeAt(this.state.pos + 1) === 10) {
            ++this.state.pos;
          }
          /* fallthrough */
        case 10: case 8232: case 8233:
          ++this.state.pos;
          ++this.state.curLine;
          this.state.lineStart = this.state.pos;
          break;

        // TODO: skip bash comments for bash. allow custom comment formats

        default:
          if ((ch > 8 && ch < 14) || (ch >= 5760 && nonASCIIwhitespace.test(String.fromCharCode(ch)))) {
            ++this.state.pos;
          } else {
            break loop;
          }
      }
    }
  }

  // Called at the end of every token. Sets `end`, `val`, and
  // maintains `context` and `exprAllowed`, and skips the space after
  // the token, so that the next one's `start` will point at the
  // right position.

  finishToken(type, val) {
    this.state.end = this.state.pos;
    this.state.endLine = this.state.curLine;
    this.state.endColumn = this.state.curColumn;
    this.state.type = type;
    this.state.value = val;
  }

  // ### Token reading

  // This is the function that is called to fetch the next token. It
  // is somewhat obscure, because it works in character codes rather
  // than characters, and because operator parsing has been inlined
  // into it.
  //
  // All in the name of speed.
  //
  // eslint-disable-next-line camelcase
  readToken_dot() {
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next >= 48 && next <= 57) {
      return this.readNumber(true);
    }

    const next2 = this.input.charCodeAt(this.state.pos + 2);
    if (next === 46 && next2 === 46) { // 46 = dot '.'
      this.state.pos += 3;
      return this.finishToken(tt.ellipsis);
    }
    ++this.state.pos;
    return this.finishToken(tt.dot);
  }

  // eslint-disable-next-line camelcase
  readToken_slash() { // '/'
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === 61) {
      return this.finishOp(tt.assign, 2);
    }
    return this.finishOp(tt.slash, 1);
  }

  // eslint-disable-next-line camelcase
  readToken_mult_modulo(code) { // '%*'
    let type = code === 42 ? tt.star : tt.modulo;
    let width = 1;
    let next = this.input.charCodeAt(this.state.pos + 1);

    if (next === 42) { // '*'
      width++;
      next = this.input.charCodeAt(this.state.pos + 2);
      type = tt.exponent;
    }

    if (next === 61) {
      width++;
      type = tt.assign;
    }

    return this.finishOp(type, width);
  }

  // eslint-disable-next-line camelcase
  readToken_pipe_amp(code) { // '|&'
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === code) return this.finishOp(code === 124 ? tt.logicalOR : tt.logicalAND, 2);
    if (next === 61) return this.finishOp(tt.assign, 2);
    return this.finishOp(code === 124 ? tt.bitwiseOR : tt.bitwiseAND, 1);
  }

  // eslint-disable-next-line camelcase
  readToken_caret() { // '^'
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === 61) {
      return this.finishOp(tt.assign, 2);
    }
    return this.finishOp(tt.bitwiseXOR, 1);
  }

  // eslint-disable-next-line camelcase
  readToken_plus_min(code) { // '+-'
    const next = this.input.charCodeAt(this.state.pos + 1);

    if (next === code) {
      if (next === 45 && this.input.charCodeAt(this.state.pos + 2) === 62 && lineBreak.test(this.input.slice(this.state.lastTokEnd, this.state.pos))) {
        // A `-->` line comment
        this.skipLineComment(3);
        this.skipSpace();
        return this.nextToken();
      }
      return this.finishOp(tt.incDec, 2);
    }

    if (next === 61) {
      return this.finishOp(tt.assign, 2);
    }
    return this.finishOp(tt.plusMin, 1);
  }

  // eslint-disable-next-line camelcase
  readToken_lt_gt(code) { // '<>'
    const next = this.input.charCodeAt(this.state.pos + 1);
    let size = 1;

    if (next === code) {
      size = code === 62 && this.input.charCodeAt(this.state.pos + 2) === 62 ? 3 : 2;
      if (this.input.charCodeAt(this.state.pos + size) === 61) return this.finishOp(tt.assign, size + 1);
      return this.finishOp(tt.bitShift, size);
    }

    if (next === 33 && code === 60 && this.input.charCodeAt(this.state.pos + 2) === 45 && this.input.charCodeAt(this.state.pos + 3) === 45) {
      if (this.inModule) this.unexpected();
      // `<!--`, an XML-style comment that should be interpreted as a line comment
      this.skipLineComment(4);
      this.skipSpace();
      return this.nextToken();
    }

    if (next === 61) {
      // <= | >=
      size = 2;
    }

    return this.finishOp(tt.relational, size);
  }

  // eslint-disable-next-line camelcase
  readToken_eq_excl(code) { // '=!'
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === 61) return this.finishOp(tt.equality, this.input.charCodeAt(this.state.pos + 2) === 61 ? 3 : 2);
    if (code === 61 && next === 62) { // '=>'
      this.state.pos += 2;
      return this.finishToken(tt.arrow);
    }
    return this.finishOp(code === 61 ? tt.eq : tt.prefix, 1);
  }

  getTokenFromCode(code) {
    let next;
    switch (code) {
      // The interpretation of a dot depends on whether it is followed
      // by a digit or another two dots.
      case 46: // '.'
        return this.readToken_dot();

      // Punctuation tokens.
      case 40:
        ++this.state.pos;
        return this.finishToken(tt.parenL);
      case 41:
        ++this.state.pos;
        return this.finishToken(tt.parenR);
      case 59:
        ++this.state.pos;
        return this.finishToken(tt.semi);
      case 44:
        ++this.state.pos;
        return this.finishToken(tt.comma);
      case 91:
        ++this.state.pos;
        return this.finishToken(tt.bracketL);
      case 93:
        ++this.state.pos;
        return this.finishToken(tt.bracketR);
      case 123:
        ++this.state.pos;
        return this.finishToken(tt.braceL);
      case 125:
        ++this.state.pos;
        return this.finishToken(tt.braceR);

      case 58:
        if (this.hasPlugin('functionBind') && this.input.charCodeAt(this.state.pos + 1) === 58) {
          return this.finishOp(tt.doubleColon, 2);
        }
        ++this.state.pos;
        return this.finishToken(tt.colon);

      case 63:
        ++this.state.pos;
        return this.finishToken(tt.question);
      case 64:
        ++this.state.pos;
        return this.finishToken(tt.at);

      case 96: // '`'
        ++this.state.pos;
        return this.finishToken(tt.backQuote);

      case 48: // '0'
        next = this.input.charCodeAt(this.state.pos + 1);
        if (next === 120 || next === 88) return this.readRadixNumber(16); // '0x', '0X' - hex number
        if (next === 98 || next === 66) return this.readRadixNumber(2); // '0b', '0B' - binary number
        // Anything else beginning with a digit is an integer, octal
        // number, or float.

        // fallthrough
      case 49: case 50: case 51: case 52: case 53: case 54: case 55: case 56: case 57: // 1-9
        return this.readNumber(false);

      // Operators are parsed inline in tiny state machines. '=' (61) is
      // often referred to. `finishOp` simply skips the amount of
      // characters it is given as second argument, and returns a token
      // of the type given by its first argument.

      case 47: // '/'
        return this.readToken_slash();

      case 37: case 42: // '%*'
        return this.readToken_mult_modulo(code);

      case 124: case 38: // '|&'
        return this.readToken_pipe_amp(code);

      case 94: // '^'
        return this.readToken_caret();

      case 43: case 45: // '+-'
        return this.readToken_plus_min(code);

      case 60: case 62: // '<>'
        return this.readToken_lt_gt(code);

      case 61: case 33: // '=!'
        return this.readToken_eq_excl(code);

      case 126: // '~'
        return this.finishOp(tt.prefix, 1);

      // no default
    }

    this.raise(this.state.pos, `Unexpected character '${codePointToString(code)}'`);
  }

  finishOp(type, size) {
    const str = this.input.slice(this.state.pos, this.state.pos + size);
    this.state.pos += size;
    return this.finishToken(type, str);
  }

  // Read an integer in the given radix. Return null if zero digits
  // were read, the integer value otherwise. When `len` is given, this
  // will return `null` unless the integer has exactly `len` digits.

  readInt(radix, len) {
    const start = this.state.pos;
    let total = 0;
    for (let i = 0, e = len == null ? Infinity : len; i < e; ++i) {
      const code = this.input.charCodeAt(this.state.pos);
      let val;
      if (code >= 97) {
        val = code - 97 + 10; // a
      } else if (code >= 65) {
        val = code - 65 + 10; // A
      } else if (code >= 48 && code <= 57) {
        val = code - 48; // 0-9
      } else {
        val = Infinity;
      }
      if (val >= radix) break;
      ++this.state.pos;
      total = (total * radix) + val;
    }
    if (this.state.pos === start || (len != null && this.state.pos - start !== len)) return null;

    return total;
  }

  readRadixNumber(radix) {
    this.state.pos += 2; // 0x
    const val = this.readInt(radix);
    if (val == null) this.raise(this.state.start + 2, 'Expected number in radix ' + radix);
    if (isIdentifierStart(this.fullCharCodeAtPos())) this.raise(this.state.pos, 'Identifier directly after number');
    return this.finishToken(tt.num, val);
  }

  // Read an integer, octal integer, or floating-point number.

  readNumber(startsWithDot) {
    const start = this.state.pos;
    let isFloat = false;
    if (!startsWithDot && this.readInt(10) === null) this.raise(start, 'Invalid number');
    let next = this.input.charCodeAt(this.state.pos);
    if (next === 46) { // '.'
      ++this.state.pos;
      this.readInt(10);
      isFloat = true;
      next = this.input.charCodeAt(this.state.pos);
    }
    if (next === 69 || next === 101) { // 'eE'
      next = this.input.charCodeAt(++this.state.pos);
      if (next === 43 || next === 45) ++this.state.pos; // '+-'
      if (this.readInt(10) === null) this.raise(start, 'Invalid number');
      isFloat = true;
    }
    if (isIdentifierStart(this.fullCharCodeAtPos())) this.raise(this.state.pos, 'Identifier directly after number');

    const str = this.input.slice(start, this.state.pos);
    let val;
    if (isFloat) {
      val = parseFloat(str);
    } else {
      val = parseInt(str, 10);
    }
    return this.finishToken(tt.num, val);
  }

  // Read a string value, interpreting backslash-escapes.

  readCodePoint() {
    const ch = this.input.charCodeAt(this.state.pos);
    let code;

    if (ch === 123) {
      const codePos = this.state.pos;
      ++this.state.pos;
      code = this.readHexChar(this.input.indexOf('}', this.state.pos) - this.state.pos);
      ++this.state.pos;
      if (code > 0x10FFFF) this.raise(codePos, 'Code point out of bounds');
    } else {
      code = this.readHexChar(4);
    }
    return code;
  }

  // Used to read escaped characters

  readEscapedChar() {
    const ch = this.input.charCodeAt(++this.state.pos);
    ++this.state.pos;
    switch (ch) {
      case 110: return '\n'; // 'n' -> '\n'
      case 114: return '\r'; // 'r' -> '\r'
      case 120: return String.fromCharCode(this.readHexChar(2)); // 'x'
      case 117: return codePointToString(this.readCodePoint()); // 'u'
      case 116: return '\t'; // 't' -> '\t'
      case 98: return '\b'; // 'b' -> '\b'
      case 118: return '\u000b'; // 'v' -> '\u000b'
      case 102: return '\f'; // 'f' -> '\f'
      case 13: if (this.input.charCodeAt(this.state.pos) === 10) ++this.state.pos; // '\r\n'
        // fallthrough
      case 10: // ' \n'
        this.state.lineStart = this.state.pos;
        ++this.state.curLine;
        return '';
      default:
        return String.fromCharCode(ch);
    }
  }

  // Used to read character escape sequences ('\x', '\u', '\U').

  readHexChar(len) {
    const codePos = this.state.pos;
    const n = this.readInt(16, len);
    if (n === null) this.raise(codePos, 'Bad character escape sequence');
    return n;
  }

  // Read an identifier, and return it as a string. Sets `this.state.containsEsc`
  // to whether the word contained a '\u' escape.
  //
  // Incrementally adds only escaped chars, adding other chunks as-is
  // as a micro-optimization.

  readWord1() {
    this.state.containsEsc = false;
    let word = '';
    let first = true;
    let chunkStart = this.state.pos;
    while (this.state.pos < this.input.length) {
      const ch = this.fullCharCodeAtPos();
      if (isIdentifierChar(ch)) {
        this.state.pos += ch <= 0xffff ? 1 : 2;
      } else if (ch === 92) { // "\"
        this.state.containsEsc = true;

        word += this.input.slice(chunkStart, this.state.pos);
        const escStart = this.state.pos;

        if (this.input.charCodeAt(++this.state.pos) !== 117) { // "u"
          this.raise(this.state.pos, 'Expecting Unicode escape sequence \\uXXXX');
        }

        ++this.state.pos;
        const esc = this.readCodePoint();
        if (!(first ? isIdentifierStart : isIdentifierChar)(esc, true)) {
          this.raise(escStart, 'Invalid Unicode escape');
        }

        word += codePointToString(esc);
        chunkStart = this.state.pos;
      } else {
        break;
      }
      first = false;
    }
    return word + this.input.slice(chunkStart, this.state.pos);
  }

  // Read an identifier or keyword token. Will check for reserved
  // words when necessary.

  readWord() {
    const word = this.readWord1();
    let type = tt.name;
    if (!this.state.containsEsc && this.isKeyword(word)) {
      type = keywordTypes[word];
    }
    return this.finishToken(type, word);
  }
}
