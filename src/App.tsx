import { Route, Routes } from 'react-router-dom'
import ComparePage from './pages/ComparePage'
import HomePage from './pages/HomePage'
import TracePage from './pages/TracePage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/trace/:traceId" element={<TracePage />} />
      <Route path="/compare" element={<ComparePage />} />
    </Routes>
  )
}
