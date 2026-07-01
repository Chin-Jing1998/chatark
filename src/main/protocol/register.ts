import { protocol } from 'electron'
import { CONVO_SCHEME } from '@shared/viewer'

/**
 * 必须在 app ready 之前调用：把 convo:// 注册为 privileged scheme。
 * standard+secure 让其拥有正常 origin 语义；不同 host 即不同 origin。
 */
export function registerConvoScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CONVO_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true
      }
    }
  ])
}
