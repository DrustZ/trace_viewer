import { Route, Routes } from 'react-router-dom'
import { LiveUpdates } from './api/live'
import ThemeToggle from './components/common/ThemeToggle'
import AceAnalysisPage from './pages/AceAnalysisPage'
import AceExperimentsPage from './pages/AceExperimentsPage'
import AceInteractiveLabPage from './pages/AceInteractiveLabPage'
import AceRunsPage from './pages/AceRunsPage'
import AceTasksPage from './pages/AceTasksPage'
import ComparePage from './pages/ComparePage'
import HomePage from './pages/HomePage'
import { ReviewPage } from './pages/ReviewPage'
import TracePage from './pages/TracePage'

export default function App() {
  return (
    <>
      <LiveUpdates />
      <ThemeToggle />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/trace/:traceId" element={<TracePage />} />
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/ace" element={<AceRunsPage />} />
        <Route path="/ace/analysis" element={<AceAnalysisPage />} />
        <Route path="/ace/experiments" element={<AceExperimentsPage />} />
        <Route path="/ace/lab" element={<AceInteractiveLabPage />} />
        <Route path="/ace/tasks" element={<AceTasksPage />} />
        <Route path="/ace/tasks/:scenarioId" element={<AceTasksPage />} />
        <Route path="/reviews" element={<ReviewPage />} />
      </Routes>
    </>
  )
}
