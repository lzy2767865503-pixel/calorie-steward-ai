package com.clinicalclarity.app.domain.goal

import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class GoalWriteRequest internal constructor(
    val id: Long,
    val goalKcal: Int?,
)

class GoalInitializationRequest internal constructor(
    val observedSequence: Long,
)

sealed interface GoalWriteCommit {
    data object Superseded : GoalWriteCommit
    data class Applied(val persistedGoalKcal: Int?) : GoalWriteCommit
}

/** Serializes local goal writes and prevents an older completion from overwriting newer UI state. */
class GoalWriteSequencer {
    private val sequence = AtomicLong(0L)
    private val mutex = Mutex()

    /** Captures startup state without superseding a user action made during initialization. */
    fun initializationRequest(): GoalInitializationRequest = GoalInitializationRequest(sequence.get())

    fun request(goalKcal: Int?): GoalWriteRequest = GoalWriteRequest(
        id = sequence.incrementAndGet(),
        goalKcal = goalKcal,
    )

    suspend fun initialize(
        request: GoalInitializationRequest,
        readPersisted: suspend () -> Int?,
    ): GoalWriteCommit = mutex.withLock {
        if (request.observedSequence != sequence.get()) return@withLock GoalWriteCommit.Superseded
        val persisted = readPersisted()
        if (request.observedSequence == sequence.get()) {
            GoalWriteCommit.Applied(persisted)
        } else {
            GoalWriteCommit.Superseded
        }
    }

    suspend fun commit(
        request: GoalWriteRequest,
        persistAndReadBack: suspend (Int?) -> Int?,
    ): GoalWriteCommit = mutex.withLock {
        if (request.id != sequence.get()) return@withLock GoalWriteCommit.Superseded
        val persisted = persistAndReadBack(request.goalKcal)
        if (request.id == sequence.get()) {
            GoalWriteCommit.Applied(persisted)
        } else {
            GoalWriteCommit.Superseded
        }
    }

    /** Reconciles a failed latest write, but never overwrites a newer request. */
    suspend fun reconcile(
        request: GoalWriteRequest,
        readPersisted: suspend () -> Int?,
    ): GoalWriteCommit = mutex.withLock {
        if (request.id != sequence.get()) return@withLock GoalWriteCommit.Superseded
        val persisted = readPersisted()
        if (request.id == sequence.get()) {
            GoalWriteCommit.Applied(persisted)
        } else {
            GoalWriteCommit.Superseded
        }
    }
}
