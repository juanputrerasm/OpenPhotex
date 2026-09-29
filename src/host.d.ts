/*
  The only host APIs the core uses. Browsers, Web Workers and Node.js all provide them globally.
  Declared here rather than pulling in the DOM or Node type libraries, so that anything else
  environment-specific fails to compile.
*/
declare class TextDecoder {
  constructor(label?: string);
  decode(input?: Uint8Array): string;
}

/** UTF-8 only; the writers use it for names, which are ASCII in every stock file. */
declare class TextEncoder {
  constructor();
  encode(input?: string): Uint8Array;
}
