import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './DualNBackApp' // 위의 컴포넌트를 App으로 사용한다고 가정
import { registerSW } from './registerSW'

registerSW();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)