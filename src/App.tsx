import { Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'
import TracePage from './pages/TracePage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/trace/:traceId" element={<TracePage />} />
    </Routes>
  )
}
