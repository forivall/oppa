
import Tokenizer, {Token} from './shell-tokenizer';

// eslint-disable-next-line no-unused-vars
export default function parse(input: string, options: Object) {
  throw new Error('TODO');
}

export function tokenize(input: string, options: Object = {}) {
  const tokenizer = new Tokenizer(options, input);

  return [...(function * () {
    for (const state of tokenizer) {
      yield new Token(state);
    }
  })()];
}
