import {createRoot} from 'react-dom/client'
import GenerationRecovery from './GenerationRecovery.jsx'
import {createGenerationRecoveryController} from './generationController.js'
import {mainnetDefaultSources} from './sourceSettings.js'

if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) {
  document.getElementById('root').textContent = 'Open recovery over HTTPS or through the included localhost launcher'
} else {
  const controller = createGenerationRecoveryController()
  createRoot(document.getElementById('root')).render(
    <GenerationRecovery controller={controller} initialSources={mainnetDefaultSources} />
  )
}
