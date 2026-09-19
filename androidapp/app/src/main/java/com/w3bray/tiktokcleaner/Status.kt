package com.w3bray.tiktokcleaner

/** Estado compartilhado entre o serviço (thread de trabalho) e a tela. */
object Status {

    data class Snapshot(
        val running: Boolean = false,
        val message: String = "Parado",
        val removed: Int = 0,
        val failed: Int = 0,
        val target: String = "",
    )

    @Volatile
    var snapshot: Snapshot = Snapshot()
        private set

    private val listeners = mutableListOf<(Snapshot) -> Unit>()

    @Synchronized
    fun observe(listener: (Snapshot) -> Unit) {
        listeners.add(listener)
        listener(snapshot)
    }

    @Synchronized
    fun forget(listener: (Snapshot) -> Unit) {
        listeners.remove(listener)
    }

    @Synchronized
    fun update(change: (Snapshot) -> Snapshot) {
        snapshot = change(snapshot)
        listeners.toList().forEach { it(snapshot) }
    }

    fun message(text: String) = update { it.copy(message = text) }
}
