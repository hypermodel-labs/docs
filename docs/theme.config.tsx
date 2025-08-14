import React from 'react';
import { DocsThemeConfig } from 'nextra-theme-docs';

const config: DocsThemeConfig = {
  logo: (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <img src="/hypermodel_logo.png" alt="Hypermodel" style={{ height: '24px' }} />
      <span style={{ fontWeight: 600, fontSize: '18px', color: '#ffffff' }}>hypermodel</span>
    </div>
  ),
  project: {
    link: 'https://github.com/hypermodel-labs/docs',
  },
  chat: {
    link: 'https://discord.gg/E6BfkZAwUz',
  },
  docsRepositoryBase: 'https://github.com/hypermodel-labs/docs',
  footer: {
    text: (
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
          fontSize: '14px',
          color: '#a0a0a0',
        }}
      >
        <span>© 2025 Hypermodel Inc.</span>
        <a
          href="/contact"
          style={{
            color: '#ffffff',
            textDecoration: 'none',
            transition: 'color 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
          onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
        >
          Contact
        </a>
      </div>
    ),
  },
  darkMode: false, // We're forcing dark mode
  nextThemes: {
    defaultTheme: 'dark',
    forcedTheme: 'dark',
  },
  primaryHue: 270, // Purple hue to match the original design
  primarySaturation: 60,
  navigation: true,
  sidebar: {
    defaultMenuCollapseLevel: 1,
    toggleButton: true,
  },
  toc: {
    backToTop: true,
  },
  editLink: {
    text: 'Edit this page on GitHub →',
  },
  feedback: {
    content: 'Question? Give us feedback →',
    labels: 'feedback',
  },
  banner: {
    key: 'open-source',
    text: (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          style={{
            background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
            color: 'white',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase',
          }}
        >
          NEW
        </span>
        <a href="/quickstart" style={{ color: '#ffffff', textDecoration: 'none' }}>
          We're open source →
        </a>
      </div>
    ),
    dismissible: true,
  },
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta property="og:title" content="Hypermodel Documentation" />
      <meta
        property="og:description"
        content="Context is everything - Make your coding agents & LLMs have up to date documentation on external APIs, always."
      />
      <link rel="icon" href="/favicon.ico" />
      <link rel="icon" type="image/png" href="/favicon.png" />
      <link rel="apple-touch-icon" href="/hypermodel_logo.png" />
      <style>{`
        /* Force dark mode and remove light mode styles */
        html {
          color-scheme: dark !important;
        }
        
        /* Ensure dark theme is always active */
        .nextra-body {
          background: #0a0a0a !important;
        }
        
        /* Remove any light mode specific styles */
        [data-theme="light"] {
          display: none !important;
        }
      `}</style>
    </>
  ),
  useNextSeoProps() {
    return {
      titleTemplate: '%s – Hypermodel',
    };
  },
};

export default config;
