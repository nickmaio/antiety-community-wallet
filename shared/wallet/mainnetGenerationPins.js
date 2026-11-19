// Ethereum mainnet contracts independently matched by two RPCs at finalized block 26311651.
// Evidence: docs/wallet/batch5-mainnet-fork-qualification.json. Recheck at each live read.
// Pins identify code; they do not enable mainnet or override issuer-controlled token state.
export const MAINNET_GENERATION_PINS=Object.freeze({
  chainId:1,safeVersion:'1.4.1',
  contracts:Object.freeze({
    safeSingletonAddress:'0x41675C099F32341bf84BFc5382aF534df5C7461a',
    safeProxyFactoryAddress:'0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
  }),
  contractCodeHashes:Object.freeze({
    safeSingletonAddress:'0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4',
    safeProxyFactoryAddress:'0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317',
  }),
  entryPoint:Object.freeze({address:'0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    codeHash:'0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58'}),
  module:Object.freeze({address:'0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226',
    codeHash:'0x2aea997c4e3cf0e2f333025372e219abcfde81c21fc2f8fb066414a5685dd3e0'}),
  moduleSetup:Object.freeze({address:'0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47',
    codeHash:'0xaf2d170bb766d2773c3fa88717f5b3599827478074d3767d1dee55e5c2f3fbcb'}),
  usdt:Object.freeze({address:'0xdAC17F958D2ee523a2206206994597C13D831ec7',decimals:6,
    codeHash:'0xb44fb4e949d0f78f87f79ee46428f23a2a5713ce6fc6e0beb3dda78c2ac1ea55'}),
})
