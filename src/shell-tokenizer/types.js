// ## Token types

// The assignment of fine-grained, information-carrying type objects
// allows the tokenizer to store the information it has about a
// token in a way that is very cheap for the parser to look up.

export class TokenType {
  constructor(label, conf = {}) {
    this.label = label;
    this.isAssign = Boolean(conf.isAssign);
    this.prefix = Boolean(conf.prefix);
    this.postfix = Boolean(conf.postfix);
    this.binop = conf.binop || null;
  }
}

function binop(name, prec, conf = {}) {
  return new TokenType(name, {binop: prec, ...conf});
}
const startsExpr = {startsExpr: true};

export const types = {
  num: new TokenType('num', startsExpr),
  string: new TokenType('string', startsExpr),
  name: new TokenType('name', startsExpr),
  eof: new TokenType('eof'),

  // Operators. These carry several kinds of properties to help the
  // parser use them properly (the presence of these properties is
  // what categorizes them as operators).
  //
  // `binop`, when present, specifies that this operator is a binary
  // operator, and will refer to its precedence.
  //
  // `prefix` and `postfix` mark the operator as a prefix or postfix
  // unary operator.
  //
  // `isAssign` marks all of `=`, `+=`, `-=` etcetera, which act as
  // binary operators with a very low precedence, that should result
  // in AssignmentExpression nodes.

  eq: new TokenType('=', {isAssign: true}),
  assign: new TokenType('_=', {isAssign: true}),
  incDec: new TokenType('++/--', {prefix: true, postfix: true}),
  prefix: new TokenType('prefix', {prefix: true}),
  logicalOR: binop('||', 1),
  logicalAND: binop('&&', 2),
  bitwiseOR: binop('|', 3),
  bitwiseXOR: binop('^', 4),
  bitwiseAND: binop('&', 5),
  equality: binop('==/!=', 6),
  relational: binop('</>', 7),
  bitShift: binop('<</>>', 8),
  plusMin: binop('+/-', 9, {prefix: true}),
  modulo: binop('%', 10),
  star: binop('*', 10),
  slash: binop('/', 10),
};
