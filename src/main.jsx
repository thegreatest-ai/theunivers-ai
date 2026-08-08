/**
 * Router split: the cinematic marketing site stays the front door at `/`; the product shell
 * lives under `/app/*`. They share tokens (styles.css) and nothing else — the app deliberately
 * loads no Three.js, because /app is where someone works and it has to stay quiet and fast.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import Shell from './app/Shell.jsx'
import SignIn from './app/SignIn.jsx'
import Deploy from './app/Deploy.jsx'
import Bridge from './app/Bridge.jsx'
import Thread from './app/Thread.jsx'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<App />} />

      {/* Sign-in and deploy render bare: no top bar, because there is no agent to show yet. */}
      <Route path="/app" element={<Shell bare />}>
        <Route path="signin" element={<SignIn />} />
        <Route path="deploy" element={<Deploy />} />
      </Route>

      <Route path="/app" element={<Shell />}>
        <Route index element={<Bridge />} />
        <Route path="space/:id" element={<Thread />} />
      </Route>
    </Routes>
  </BrowserRouter>
)
