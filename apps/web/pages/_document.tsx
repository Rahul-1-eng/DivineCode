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

        {/* Primary Meta Tags */}
        <meta name="title" content="DivineCode Pro | Distributed Algorithmic Training Platform" />
        <meta name="description" content="A real-time multiplayer coding arena featuring an AI Voice Interviewer, AST Plagiarism Detection, and Codeforces synchronization." />
        <meta name="theme-color" content="#020617" />

        {/* Open Graph / LinkedIn / Facebook */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://divine-code-web.vercel.app/" />
        <meta property="og:title" content="DivineCode Pro | Distributed Algorithmic Training Platform" />
        <meta property="og:description" content="A real-time multiplayer coding arena featuring an AI Voice Interviewer, AST Plagiarism Detection, and Codeforces synchronization." />
        <meta property="og:image" content="https://divine-code-web.vercel.app/og-image.png" />

        {/* Twitter */}
        <meta property="twitter:card" content="summary_large_image" />
        <meta property="twitter:url" content="https://divine-code-web.vercel.app/" />
        <meta property="twitter:title" content="DivineCode Pro | Distributed Algorithmic Training Platform" />
        <meta property="twitter:description" content="A real-time multiplayer coding arena featuring an AI Voice Interviewer, AST Plagiarism Detection, and Codeforces synchronization." />
        <meta property="twitter:image" content="https://divine-code-web.vercel.app/og-image.png" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}