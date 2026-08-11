/**
 * Router split: the cinematic marketing site stays the front door at `/`; the product shell
 * lives under `/app/*`. They share tokens (styles.css) and nothing else — the app deliberately
 * loads no Three.js, because /app is where someone works and it has to stay quiet and fast.
 *
 * Every route is `lazy`, and that is what makes the sentence above true of the BUILD and not only
 * of the source. These were static imports, so rollup had no seam to cut on and emitted one
 * 1228KB chunk: opening /app to read a list of deals downloaded three, drei, postprocessing,
 * lenis and maath first. Measured at 308KB brotli for a screen that renders none of it.
 *
 * `scripts/perf-measure.mjs` asserts the separation rather than trusting it — it fails if a module
 * of the 3D stack ever reappears in the /app graph, which a single static import at the top of
 * this file is enough to cause.
 */
import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './styles.css'

/*
 * Named exports need unwrapping for lazy(), which expects a module with a default. Two lazy calls
 * on one module still resolve to one chunk, so the pair costs one request, not two.
 *
 * DECLARED BEFORE ITS FIRST USE, and that is not a style preference. `const` is not hoisted the way
 * `function` is: it sits in the temporal dead zone until the line that declares it runs. Every
 * named() call below executes AT MODULE LOAD, so one placed above this line throws
 * "Cannot access 'named' before initialization" — before React mounts, before any error boundary
 * exists, before a single route is read. The page renders as an empty <div id="root">, with the
 * whole application intact and unreachable. That shipped once.
 *
 * If you add routes here, add them BELOW this line.
 */
const named = (load, key) => lazy(() => load().then((m) => ({ default: m[key] })))

const App = lazy(() => import('./App.jsx'))
const Shell = lazy(() => import('./app/Shell.jsx'))
const SignIn = lazy(() => import('./app/SignIn.jsx'))
const OAuthCallback = lazy(() => import('./app/OAuthCallback.jsx'))
const Deploy = lazy(() => import('./app/Deploy.jsx'))
const Home = lazy(() => import('./app/Home.jsx'))
const Thread = lazy(() => import('./app/Thread.jsx'))
const Account = lazy(() => import('./app/Account.jsx'))
const You = lazy(() => import('./app/You.jsx'))
const Workspace = lazy(() => import('./app/Workspace.jsx'))
const Mandate = lazy(() => import('./app/Mandate.jsx'))
const Discover = lazy(() => import('./app/Discover.jsx'))
const Conversations = named(() => import('./app/Messages.jsx'), 'Conversations')
const Conversation = named(() => import('./app/Messages.jsx'), 'Conversation')
const Settings = lazy(() => import('./app/Settings.jsx'))
const Privacy = named(() => import('./app/Settings.jsx'), 'Privacy')
const ProjectList = named(() => import('./app/Projects.jsx'), 'ProjectList')
const ProjectDetail = named(() => import('./app/Projects.jsx'), 'ProjectDetail')
const DealList = named(() => import('./app/Deals.jsx'), 'DealList')
const DealDetail = named(() => import('./app/Deals.jsx'), 'DealDetail')

/*
 * Deliberately empty. `body` is already --bg, so a blank frame is invisible; a spinner here would
 * flash on every navigation that resolves in a few milliseconds from cache and read as jank
 * rather than as progress.
 */
const Booting = () => null

ReactDOM.createRoot(document.getElementById('root')).render(
  <Suspense fallback={<Booting />}>
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
          <Route index element={<Home />} />
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
          {/* Named in ADR-0002 and not built. An honest placeholder rather than a dead link or a
              navigation that quietly disagrees with the decision. */}
          <Route path="discover" element={<Discover />} />
          <Route path="messages" element={<Conversations />} />
          <Route path="messages/:id" element={<Conversation />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </Suspense>
)
