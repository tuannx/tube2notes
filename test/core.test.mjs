import { test } from 'node:test'
import assert from 'node:assert'
import { extractVideoId, fallbackGenerate } from '../src/index.ts'

test('extractVideoId handles common URL shapes', () => {
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
  assert.equal(extractVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
  assert.equal(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
  assert.equal(extractVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
  assert.equal(extractVideoId('https://example.com/nope'), null)
})

test('fallbackGenerate produces a complete study pack', () => {
  const t = Array.from({length: 12}, (_, i) => `This is sentence number ${i + 1} explaining an important concept in the lecture in detail.`).join(' ')
  const out = fallbackGenerate(t)
  assert.ok(out.summary.length > 20)
  assert.ok(out.notes_md.includes('## Section'))
  assert.ok(out.concepts.length >= 3)
  assert.ok(out.flashcards.length >= 3)
  assert.ok(out.quiz.length >= 3)
  assert.equal(out.quiz[0].options.length, 4)
  assert.equal(out.quiz[0].answer_index, 0)
})
