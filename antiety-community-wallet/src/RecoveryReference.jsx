import {useState} from 'react'
import PropTypes from 'prop-types'

export default function RecoveryReference({value,label,compact=false}){
  const [feedback,setFeedback]=useState('')
  const [expanded,setExpanded]=useState(false)
  async function copy(){
    try{
      await navigator.clipboard.writeText(value)
      setFeedback('Copied')
    }catch{
      setExpanded(true)
      setFeedback('Select the full value to copy it')
    }
  }
  const display=compact&&!expanded?value.slice(0,8)+'…'+value.slice(-6):value
  return <div className="reference">
    <code title={compact?value:undefined}>{display}</code>
    <div className="reference-action">
      <button type="button" className="text-button" aria-label={'Copy '+label} onClick={copy}>Copy</button>
      <span role="status">{feedback}</span>
    </div>
  </div>
}
RecoveryReference.propTypes={value:PropTypes.string.isRequired,label:PropTypes.string.isRequired,compact:PropTypes.bool}
