declare module '@isomorphic-git/lightning-fs' {
  export default class LightningFS {
    constructor(name: string, options?: { wipe?: boolean })
    promises: any
  }
}
