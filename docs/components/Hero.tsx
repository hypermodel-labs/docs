import React from 'react';

const Hero = () => {
  return (
    <div className="hero-section">
      <div className="hero-content">
        <div className="hero-text">
          <h1 className="hero-title">
            Context is
            <br />
            everything
          </h1>
          <p className="hero-subtitle">
            Make your coding agents have up to date
            <br />
            documentation on external APIs, <em>always</em>.
          </p>
          <div className="hero-command">npx @hypermodel/cli add-docs claude</div>
        </div>

        <div className="terminal-demo">
          <div className="terminal-header">
            <div className="terminal-dots">
              <div className="terminal-dot"></div>
              <div className="terminal-dot"></div>
              <div className="terminal-dot"></div>
            </div>
          </div>
          <div className="terminal-content">
            <div className="terminal-line">
              <span className="terminal-prompt">+ </span>
              <span>Welcome to Claude Code!</span>
            </div>
            <div className="terminal-line"></div>
            <div className="terminal-line">
              <span className="terminal-prompt">&gt; </span>
              <span className="terminal-command">
                can you create an upsert of this table with supabase? use docs tool
              </span>
            </div>
            <div className="terminal-line"></div>
            <div className="terminal-line">
              <span className="terminal-prompt">&gt; </span>
              <span className="terminal-command">Explain `amp.tools.stopTimeout` and</span>
            </div>
            <div className="terminal-line">
              <span className="terminal-prompt">&gt; </span>
              <span className="terminal-command">
                ts default in the docs of ampcode. use docs tool
              </span>
            </div>
            <div className="terminal-line"></div>
            <div className="terminal-line">
              <span className="terminal-prompt">&gt; </span>
              <span className="terminal-command">Understand how temporal activities work</span>
            </div>
            <div className="terminal-line">
              <span className="terminal-prompt">&gt; </span>
              <span className="terminal-command">
                & wrap function `index` with a temporal activity,
              </span>
            </div>
            <div className="terminal-line">
              <span className="terminal-prompt">&gt; </span>
              <span className="terminal-command">use docs tool</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Hero;
