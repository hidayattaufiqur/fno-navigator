<script>
  import { page } from '$app/stores'
  import { missingTableIssueUrl } from '$lib/utils'

  $: errPath = $page.url.pathname
  $: missingName =
    $page.status === 404 && errPath.startsWith('/tables/') ? (errPath.split('/')[2] ?? '') : ''
  $: issueUrl =
    missingName !== ''
      ? missingTableIssueUrl(missingName, `/tables/${missingName} (${$page.url.href})`)
      : ''
</script>

<div class="error-page">
  <p class="eyebrow">Error {$page.status}</p>
  <h2>{$page.error?.message ?? 'Something went wrong'}</h2>
  {#if $page.status === 404}
    <p class="mini">That page doesn't exist. Try the table reference or head back to the flow overview.</p>
    {#if issueUrl !== ''}
      <a class="nav-link" target="_blank" rel="noopener" href={issueUrl}>Report missing table</a>
    {/if}
  {/if}
  <a href="/" class="nav-link">← Back to home</a>
</div>

<style>
  .error-page {
    padding: 48px 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
</style>
