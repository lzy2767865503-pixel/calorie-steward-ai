package com.clinicalclarity.app.domain.goal

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GoalWriteSequencerTest {
    @Test
    fun `startup read cannot overwrite a goal requested immediately after launch`() = runTest {
        val sequencer = GoalWriteSequencer()
        val initialization = sequencer.initializationRequest()
        val set = sequencer.request(2_100)
        var startupReadCalled = false

        val initializationResult = sequencer.initialize(initialization) {
            startupReadCalled = true
            1_700
        }
        val setResult = sequencer.commit(set) { it }

        assertTrue(initializationResult is GoalWriteCommit.Superseded)
        assertEquals(false, startupReadCalled)
        assertEquals(2_100, (setResult as GoalWriteCommit.Applied).persistedGoalKcal)
    }

    @Test
    fun `startup read already in IO is suppressed when a user goal arrives`() = runTest {
        val sequencer = GoalWriteSequencer()
        val initialization = sequencer.initializationRequest()
        val enteredIo = CompletableDeferred<Unit>()
        val releaseIo = CompletableDeferred<Unit>()
        val initializationResult = async {
            sequencer.initialize(initialization) {
                enteredIo.complete(Unit)
                releaseIo.await()
                1_700
            }
        }
        enteredIo.await()
        val set = sequencer.request(2_100)
        val setResult = async { sequencer.commit(set) { it } }
        releaseIo.complete(Unit)

        assertTrue(initializationResult.await() is GoalWriteCommit.Superseded)
        assertEquals(2_100, (setResult.await() as GoalWriteCommit.Applied).persistedGoalKcal)
    }

    @Test
    fun `rapid set then set persists only newest queued request`() = runTest {
        val sequencer = GoalWriteSequencer()
        val first = sequencer.request(1_800)
        val second = sequencer.request(2_200)
        val writes = mutableListOf<Int?>()

        val firstResult = sequencer.commit(first) { writes += it; it }
        val secondResult = sequencer.commit(second) { writes += it; it }

        assertTrue(firstResult is GoalWriteCommit.Superseded)
        assertEquals(listOf<Int?>(2_200), writes)
        assertEquals(2_200, (secondResult as GoalWriteCommit.Applied).persistedGoalKcal)
    }

    @Test
    fun `set already in IO cannot publish stale state when clear arrives`() = runTest {
        val sequencer = GoalWriteSequencer()
        val first = sequencer.request(1_900)
        val enteredIo = CompletableDeferred<Unit>()
        val releaseIo = CompletableDeferred<Unit>()
        val writes = mutableListOf<Int?>()
        val firstResult = async {
            sequencer.commit(first) { value ->
                writes += value
                enteredIo.complete(Unit)
                releaseIo.await()
                value
            }
        }
        enteredIo.await()
        val clear = sequencer.request(null)
        val clearResult = async {
            sequencer.commit(clear) { value -> writes += value; value }
        }
        releaseIo.complete(Unit)

        assertTrue(firstResult.await() is GoalWriteCommit.Superseded)
        assertEquals(null, (clearResult.await() as GoalWriteCommit.Applied).persistedGoalKcal)
        assertEquals(listOf<Int?>(1_900, null), writes)
    }
}
