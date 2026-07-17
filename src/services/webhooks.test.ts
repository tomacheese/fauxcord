import { describe, it, expect } from 'vitest'
import { buildGithubEmbed } from './webhooks'

describe('buildGithubEmbed', () => {
  it('builds a push-event embed from head_commit', () => {
    const embed = buildGithubEmbed({
      head_commit: { message: 'fix: bug', id: 'abc123' },
      repository: { full_name: 'owner/repo' },
      sender: { login: 'octocat' },
    })

    expect(embed.title).toContain('owner/repo')
    expect(embed.description).toBe('fix: bug')
    expect(embed.author?.name).toBe('octocat')
  })

  it('builds an issue-event embed from issue', () => {
    const embed = buildGithubEmbed({
      action: 'opened',
      issue: {
        title: 'Bug report',
        html_url: 'https://github.com/x/y/issues/1',
      },
      sender: { login: 'octocat' },
    })

    expect(embed.title).toContain('Bug report')
    expect(embed.url).toBe('https://github.com/x/y/issues/1')
  })

  it('falls back to a minimal embed for an unrecognized payload shape', () => {
    const embed = buildGithubEmbed({ sender: { login: 'octocat' } })

    expect(embed.title).toBe('GitHub event')
    expect(embed.author?.name).toBe('octocat')
  })
})
