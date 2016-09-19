
import {default as tt} from './shell-tokenizer/types';

// ### Expression parsing

// These nest, from the most general expression type at the top to
// 'atomic', nondivisible expression types at the bottom. Most of
// the functions will simply let the function (s) below them parse,
// and, *if* the syntactic construct they handle is present, wrap
// the AST node that the inner parser gave them in another node.

// Parse a full expression. The optional arguments are used to
// forbid the `in` operator (in for loops initalization expressions)
// and provide reference for storing '=' operator inside shorthand
// property assignment in contexts where both object expression
// and object pattern might appear (so it's possible to raise
// delayed syntax error at correct position).

export default class ArithmeticParser {
  parseExpression() {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    const expr = this.parseMaybeAssign();
    if (this.match(tt.comma)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.expressions = [expr];
      while (this.eat(tt.comma)) {
        node.expressions.push(this.parseMaybeAssign());
      }
      this.toReferencedList(node.expressions);
      return this.finishNode(node, 'SequenceExpression');
    }
    return expr;
  }

  // Parse an assignment expression. This includes applications of
  // operators like `+=`.

  parseMaybeAssign() {
    if (this.match(tt._yield) && this.state.inGenerator) {
      return this.parseYield();
    }

    const startPos = this.state.start;
    const startLoc = this.state.startLoc;

    if (this.match(tt.parenL) || this.match(tt.name)) {
      this.state.potentialArrowAt = this.state.start;
    }

    const left = this.parseMaybeConditional();
    if (this.state.type.isAssign) {
      const node = this.startNodeAt(startPos, startLoc);
      node.operator = this.state.value;
      node.left = this.match(tt.eq) ? this.toAssignable(left) : left;

      this.checkLVal(left);

      this.next();
      node.right = this.parseMaybeAssign();
      return this.finishNode(node, 'AssignmentExpression');
    }

    return left;
  }

  // Parse a ternary conditional (`?:`) operator.

  parseMaybeConditional() {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    const expr = this.parseExprOps();

    return this.parseConditional(expr, startPos, startLoc);
  }

  parseConditional(expr, startPos, startLoc) {
    if (this.eat(tt.question)) {
      const node = this.startNodeAt(startPos, startLoc);
      node.test = expr;
      node.consequent = this.parseMaybeAssign();
      this.expect(tt.colon);
      node.alternate = this.parseMaybeAssign();
      return this.finishNode(node, 'ConditionalExpression');
    }
    return expr;
  }

  // Start the precedence parser.

  parseExprOps() {
    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    const expr = this.parseMaybeUnary();
    return this.parseExprOp(expr, startPos, startLoc, -1);
  }

  // Parse binary operators with the operator precedence parsing
  // algorithm. `left` is the left-hand side of the operator.
  // `minPrec` provides context that allows the function to stop and
  // defer further parser to one of its callers when it encounters an
  // operator that has a lower precedence than the set it is parsing.

  parseExprOp(left, leftStartPos, leftStartLoc, minPrec) {
    const prec = this.state.type.binop;
    if (prec != null && (!this.match(tt._in))) {
      if (prec > minPrec) {
        const node = this.startNodeAt(leftStartPos, leftStartLoc);
        node.left = left;
        node.operator = this.state.value;

        if (
          node.operator === '**' &&
          left.type === 'UnaryExpression' &&
          left.extra &&
          !left.extra.parenthesizedArgument &&
          !left.extra.parenthesized
        ) {
          this.raise(left.argument.start, 'Illegal expression. Wrap left hand side or entire exponentiation in parentheses.');
        }

        const op = this.state.type;
        this.next();

        const startPos = this.state.start;
        const startLoc = this.state.startLoc;
        node.right = this.parseExprOp(this.parseMaybeUnary(), startPos, startLoc, op.rightAssociative ? prec - 1 : prec);

        this.finishNode(node, (op === tt.logicalOR || op === tt.logicalAND) ? 'LogicalExpression' : 'BinaryExpression');
        return this.parseExprOp(node, leftStartPos, leftStartLoc, minPrec);
      }
    }
    return left;
  }

  // Parse unary operators, both prefix and postfix.
  parseMaybeUnary() {
    if (this.state.type.prefix) {
      const node = this.startNode();
      const update = this.match(tt.incDec);
      node.operator = this.state.value;
      node.prefix = true;
      this.next();

      const argType = this.state.type;
      node.argument = this.parseMaybeUnary();

      this.addExtra(node, 'parenthesizedArgument', argType === tt.parenL && (!node.argument.extra || !node.argument.extra.parenthesized));

      if (update) {
        this.checkLVal(node.argument);
      } else if (this.state.strict && node.operator === 'delete' && node.argument.type === 'Identifier') {
        this.raise(node.start, 'Deleting local variable in strict mode');
      }

      return this.finishNode(node, update ? 'UpdateExpression' : 'UnaryExpression');
    }

    const startPos = this.state.start;
    const startLoc = this.state.startLoc;
    let expr = this.parseExprSubscripts();

    while (this.state.type.postfix && !this.canInsertSemicolon()) {
      const node = this.startNodeAt(startPos, startLoc);
      node.operator = this.state.value;
      node.prefix = false;
      node.argument = expr;
      this.checkLVal(expr);
      this.next();
      expr = this.finishNode(node, 'UpdateExpression');
    }
    return expr;
  }
}
