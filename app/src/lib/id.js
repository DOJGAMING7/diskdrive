export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2,10))
export const now = () => Date.now()
