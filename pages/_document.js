import NextDocument, { Html, Head, Main, NextScript } from 'next/document';

/**
 * Custom Document - Propagates CSP nonce to all framework scripts and styles.
 *
 * The middleware generates a unique nonce per request and sets it as the
 * `x-nonce` request header. This Document reads it during SSR and passes
 * it to <Head> and <NextScript>, which causes Next.js to add nonce="{value}"
 * to all injected <script> and <link> tags.
 */
export default function Document({ nonce }) {
  return (
    <Html lang="en" data-scroll-behavior="smooth">
      <Head nonce={nonce} />
      <body>
        <Main />
        <NextScript nonce={nonce} />
      </body>
    </Html>
  );
}

Document.getInitialProps = async (ctx) => {
  const initialProps = await NextDocument.getInitialProps(ctx);
  const nonce = ctx.req?.headers?.['x-nonce'] || '';
  return { ...initialProps, nonce };
};
