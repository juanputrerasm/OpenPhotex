/*
  The only host API the core uses. Browsers, Web Workers and Node.js all provide it globally.
  Declared here rather than pulling in the DOM or Node type libraries, so that anything else
  environment-specific fails to compile.
*/
declare class TextDecoder {
  constructor(label?: string);
  decode(input?: Uint8Array): string;
}
