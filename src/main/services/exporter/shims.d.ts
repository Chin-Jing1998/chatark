/** Vite `?raw` 资源导入：把文件内容作为原始字符串引入。 */
declare module '*.html?raw' {
  const content: string
  export default content
}
