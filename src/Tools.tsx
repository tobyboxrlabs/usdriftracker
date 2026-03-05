import { useState } from 'react'
import { Link } from 'react-router-dom'
import MintRedeemAnalyser from './MintRedeemAnalyser'
import './Tools.css'

export default function Tools() {
  return (
    <div className="tools-page">
      <header className="tools-header">
        <div className="tools-header-title-row">
          <h1>Tools</h1>
        </div>
        <p className="subtitle">Analytics and analysis tools for RIF on Chain</p>
        <div className="tools-header-actions">
          <Link to="/" className="back-link">← Back to Metrics</Link>
          <Link to="/game" className="game-link">Play Light Cycle →</Link>
        </div>
      </header>

      <div className="tools-container">
        <MintRedeemAnalyser />
      </div>
    </div>
  )
}
