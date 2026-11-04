/**
 * @file _document.tsx
 * @author Rahul Kumar Sahoo
 * @description Page-level experience and view logic.
 */

import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* The icon is versioned so the browser reloads the latest asset. */}
        <link rel="icon" href="/favicon.ico?v=2" />
        <link rel="apple-touch-icon" href="/favicon.ico?v=2" />
        <link rel="shortcut icon" href="/favicon.ico?v=2" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="canonical" href="https://divine-code-web.vercel.app/" />

        {/* Primary Meta Tags */}
        <title>DivineCode | Competitive Programming and AI Interviews</title>
        <meta name="title" content="DivineCode | Competitive Programming and AI Interviews" />
        <meta name="description" content="DivineCode is a competitive programming platform for DSA practice, live contests, coding duels, AI mock interviews, and recruiter sessions." />
        <meta name="google-site-verification" content="SIAV4zdzeV3LJURPDtOZNFORokqRy29lARhhZHulEhg" />
        <meta name="robots" content="index, follow, max-image-preview:large" />
        <meta name="googlebot" content="index, follow" />
        <meta name="theme-color" content="#020617" />

        {/* Open Graph / LinkedIn / Facebook */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://divine-code-web.vercel.app/" />
        <meta property="og:title" content="DivineCode | Competitive Programming and AI Interviews" />
        <meta property="og:description" content="Practice DSA, compete in live contests, duel in real time, and prepare for technical interviews with DivineCode." />
        <meta property="og:image" content="https://divine-code-web.vercel.app/logo.png" />

        {/* Twitter */}
        <meta property="twitter:card" content="summary_large_image" />
        <meta property="twitter:url" content="https://divine-code-web.vercel.app/" />
        <meta property="twitter:title" content="DivineCode | Competitive Programming and AI Interviews" />
        <meta property="twitter:description" content="Practice DSA, compete in live contests, duel in real time, and prepare for technical interviews with DivineCode." />
        <meta property="twitter:image" content="https://divine-code-web.vercel.app/logo.png" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}