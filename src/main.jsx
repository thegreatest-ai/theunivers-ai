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
import OAuthCallback from './app/OAuthCallback.jsx'
import Deploy from './app/Deploy.jsx'
import Bridge from './app/Bridge.jsx'
import Thread from './app/Thread.jsx'
import Account from './app/Account.jsx'
import You from './app/You.jsx'
import Settings, { Privacy } from './app/Settings.jsx'
import Workspace from './app/Workspace.jsx'
import { ProjectList, ProjectDetail } from './app/Projects.jsx'
import Mandate from './app/Mandate.jsx'
import { DealList, DealDetail } from './app/Deals.jsx'
import Discover from './app/Discover.jsx'
import Soon from './app/Soon.jsx'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<App />} />

      <Route path="/app" element={<Shell bare />}>
        <Route path="signin" element={<SignIn />} />
        <Route path="join" element={<SignIn initialMode="create" />} />
        <Route path="oauth" element={<OAuthCallback />} />
        <Route path="deploy" element={<Deploy />} />
      </Route>

      <Route path="/app" element={<Shell />}>
        <Route index element={<Bridge />} />
        <Route path="space/:id" element={<Thread />} />
        <Route path="account" element={<You />} />
        <Route path="account/signin" element={<Account />} />
        <Route path="workspace" element={<Workspace />} />
        <Route path="projects" element={<ProjectList />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="settings" element={<Settings />} />
        <Route path="settings/privacy" element={<Privacy />} />
        <Route path="mandate" element={<Mandate />} />
        <Route path="deals" element={<DealList />} />
        <Route path="deals/:id" element={<DealDetail />} />
        <Route path="discover" element={<Discover />} />
        {/* Named in ADR-0002 and not built. An honest placeholder rather than a dead link or a
            navigation that quietly disagrees with the decision. */}
        <Route path="messages" element={<Soon what="Messages" />} />
      </Route>
    </Routes>
  </BrowserRouter>
)
