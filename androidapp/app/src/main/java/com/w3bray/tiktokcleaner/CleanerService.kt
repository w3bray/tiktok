package com.w3bray.tiktokcleaner

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityService.ScreenshotResult
import android.accessibilityservice.AccessibilityService.TakeScreenshotCallback
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.random.Random

/**
 * Faz no app do TikTok o mesmo que um dedo faria: lê a tela pelo serviço de
 * acessibilidade, acha os botões e toca neles até a aba zerar. Sem adb, sem
 * PC, sem root.
 *
 * O serviço só enxerga o TikTok: a lista de pacotes está no
 * res/xml/accessibility_service_config.xml.
 */
class CleanerService : AccessibilityService() {

    enum class Target(val label: String) {
        LIKES("curtidos"),
        REPOSTS("republicados"),
    }

    private enum class Outcome { REMOVED, ALREADY, FAILED }

    data class Job(val targets: List<Target>, val limit: Int)

    companion object {
        @Volatile
        var instance: CleanerService? = null
            private set

        /** Itens por varredura antes de recarregar a grade. */
        private const val BATCH = 9
        private const val MAX_PASSES = 300
        private const val RED_THRESHOLD = 0.12
    }

    @Volatile
    private var running = false
    private val executor = Executors.newSingleThreadExecutor()

    override fun onServiceConnected() {
        instance = this
        Status.message("Pronto. Abra o TikTok e toque em uma das opções.")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() {
        running = false
    }

    override fun onDestroy() {
        running = false
        instance = null
        super.onDestroy()
    }

    // ------------------------------------------------------------- controle

    fun startJob(job: Job) {
        if (running) return
        running = true
        Status.update {
            it.copy(running = true, removed = 0, failed = 0, message = "Abrindo o TikTok...")
        }
        Thread { work(job) }.start()
    }

    fun stopJob() {
        running = false
        Status.update { it.copy(running = false, message = "Parado por você.") }
    }

    private fun work(job: Job) {
        var budget = job.limit
        try {
            if (!openApp()) {
                finish("TikTok não encontrado neste aparelho.")
                return
            }

            for (target in job.targets) {
                if (!running) break
                budget = clean(target, budget)
            }

            if (!running) {
                finish("Parado.")
                return
            }

            val clean = job.targets.all { verifyEmpty(it) }
            finish(if (clean) "100% limpo." else "Incompleto: sobraram itens.")
        } catch (error: Exception) {
            finish("Erro: ${error.message}")
        }
    }

    private fun finish(message: String) {
        running = false
        Status.update { it.copy(running = false, message = message) }
    }

    // ------------------------------------------------------------ primitivas

    private fun pause(min: Long = 900, max: Long = 1800) {
        try {
            Thread.sleep(Random.nextLong(min, max))
        } catch (interrupted: InterruptedException) {
            running = false
        }
    }

    private fun allNodes(): List<AccessibilityNodeInfo> {
        val root = rootInActiveWindow ?: return emptyList()
        val out = ArrayList<AccessibilityNodeInfo>()
        collect(root, out, 0)
        return out
    }

    private fun collect(node: AccessibilityNodeInfo?, out: MutableList<AccessibilityNodeInfo>, depth: Int) {
        if (node == null || depth > 60 || out.size > 2500) return
        out.add(node)
        for (index in 0 until node.childCount) collect(node.getChild(index), out, depth + 1)
    }

    private fun boxOf(node: AccessibilityNodeInfo): Box {
        val rect = Rect()
        node.getBoundsInScreen(rect)
        return Box(rect.left, rect.top, rect.right, rect.bottom)
    }

    /** Menor view que casa: em listas o pai repete o texto do filho. */
    private fun find(
        patterns: List<String>,
        from: List<AccessibilityNodeInfo> = allNodes(),
    ): AccessibilityNodeInfo? =
        from.filter { Patterns.matches(it.contentDescription, it.text, patterns) }
            .minByOrNull { boxOf(it).let { box -> box.width.toLong() * box.height } }

    private fun click(node: AccessibilityNodeInfo): Boolean {
        var current: AccessibilityNodeInfo? = node
        var hops = 0

        while (current != null && hops < 6) {
            if (current.isClickable && current.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                return true
            }
            current = current.parent
            hops++
        }

        val box = boxOf(node)
        return tap(box.centerX, box.centerY)
    }

    private fun tap(x: Int, y: Int): Boolean {
        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
        val stroke = GestureDescription.StrokeDescription(path, 0L, 60L)
        return dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    private fun swipe(fromX: Int, fromY: Int, toX: Int, toY: Int, duration: Long): Boolean {
        val path = Path().apply {
            moveTo(fromX.toFloat(), fromY.toFloat())
            lineTo(toX.toFloat(), toY.toFloat())
        }
        val stroke = GestureDescription.StrokeDescription(path, 0L, duration)
        return dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    private fun back() {
        performGlobalAction(GLOBAL_ACTION_BACK)
    }

    private val screenWidth: Int get() = resources.displayMetrics.widthPixels
    private val screenHeight: Int get() = resources.displayMetrics.heightPixels

    // ------------------------------------------------------- leitura do estado

    /**
     * Captura da tela pelo próprio serviço (Android 11+). É a leitura mais
     * confiável do estado: o TikTok pinta o ícone aceso de #FE2C55.
     */
    private fun screenshot(): Bitmap? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null

        val latch = CountDownLatch(1)
        var result: Bitmap? = null

        takeScreenshot(
            Display.DEFAULT_DISPLAY,
            executor,
            object : TakeScreenshotCallback {
                override fun onSuccess(screenshot: ScreenshotResult) {
                    try {
                        val buffer = screenshot.hardwareBuffer
                        val wrapped = Bitmap.wrapHardwareBuffer(buffer, screenshot.colorSpace)
                        result = wrapped?.copy(Bitmap.Config.ARGB_8888, false)
                        wrapped?.recycle()
                        buffer.close()
                    } finally {
                        latch.countDown()
                    }
                }

                override fun onFailure(errorCode: Int) {
                    latch.countDown()
                }
            },
        )

        latch.await(5, TimeUnit.SECONDS)
        return result
    }

    private fun redFraction(box: Box): Double? {
        val bitmap = screenshot() ?: return null

        try {
            val area = Geometry.shrink(box)
            val left = area.left.coerceIn(0, bitmap.width - 1)
            val top = area.top.coerceIn(0, bitmap.height - 1)
            val right = area.right.coerceIn(left + 1, bitmap.width)
            val bottom = area.bottom.coerceIn(top + 1, bitmap.height)

            var red = 0
            var total = 0

            for (y in top until bottom) {
                for (x in left until right) {
                    val pixel = bitmap.getPixel(x, y)
                    total++
                    if (Geometry.isBrandRed(Color.red(pixel), Color.green(pixel), Color.blue(pixel))) {
                        red++
                    }
                }
            }

            return if (total == 0) null else red.toDouble() / total
        } finally {
            bitmap.recycle()
        }
    }

    /** true = aceso, false = apagado, null = não deu para ler. */
    private fun isActive(node: AccessibilityNodeInfo): Boolean? {
        redFraction(boxOf(node))?.let { return it >= RED_THRESHOLD }
        if (node.isSelected || node.isChecked) return true
        if (Patterns.matches(node.contentDescription, node.text, Patterns.activeState)) return true
        return null
    }

    // ----------------------------------------------------------- navegação

    private fun openApp(): Boolean {
        val installed = packageManager.getInstalledPackages(0).map { it.packageName }
        val target = Patterns.packages.firstOrNull { installed.contains(it) } ?: return false

        val intent = packageManager.getLaunchIntentForPackage(target) ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(intent)
        pause(3000, 4500)
        return true
    }

    private fun openProfileTab(target: Target): Boolean {
        val profile = find(Patterns.profileTab)
        if (profile == null) {
            Status.message("Não achei a aba Perfil na barra de baixo.")
            return false
        }

        click(profile)
        pause(1500, 2600)

        val patterns = if (target == Target.LIKES) Patterns.likedTab else Patterns.repostTab
        val tab = find(patterns)
        if (tab == null) {
            Status.message("Não achei a aba de ${target.label}.")
            return false
        }

        click(tab)
        pause(1800, 2800)
        return true
    }

    private fun cells(): List<Box> =
        Geometry.gridCells(allNodes().map { boxOf(it) }, screenWidth, screenHeight)

    private fun refreshGrid() {
        swipe(screenWidth / 2, (screenHeight * 0.35).toInt(), screenWidth / 2, (screenHeight * 0.75).toInt(), 400L)
        pause(1500, 2400)
    }

    // -------------------------------------------------------------- remoção

    private fun undo(target: Target): Outcome {
        val patterns = if (target == Target.LIKES) Patterns.likeButton else Patterns.repostButton
        val button = find(patterns)
            ?: return if (target == Target.REPOSTS) undoRepostViaShare() else Outcome.FAILED

        if (isActive(button) == false) return Outcome.ALREADY
        if (!click(button)) return Outcome.FAILED
        pause(1000, 1800)

        // A view pode ter sido recriada pelo toque: procura de novo.
        val after = find(patterns) ?: return Outcome.REMOVED

        return when (isActive(after)) {
            false -> Outcome.REMOVED
            null -> Outcome.REMOVED // sem leitura de estado: confia no toque
            true -> {
                click(after)
                pause(1000, 1800)
                val again = find(patterns)
                if (again == null || isActive(again) != true) Outcome.REMOVED else Outcome.FAILED
            }
        }
    }

    /** Versões sem botão de repost no painel: vai pelo menu de compartilhar. */
    private fun undoRepostViaShare(): Outcome {
        val share = find(Patterns.shareButton) ?: return Outcome.FAILED
        click(share)
        pause(1200, 2000)

        val remove = find(Patterns.removeRepost)
        if (remove == null) {
            // Nada que diga "remover repostagem": não mexe em nada.
            back()
            pause(700, 1200)
            return Outcome.ALREADY
        }

        click(remove)
        pause(1200, 2000)

        find(Patterns.confirm)?.let {
            click(it)
            pause(1000, 1800)
        }

        return Outcome.REMOVED
    }

    private fun clean(target: Target, startBudget: Int): Int {
        var budget = startBudget
        Status.update { it.copy(target = target.label, message = "Abrindo ${target.label}...") }

        for (pass in 1..MAX_PASSES) {
            if (!running || budget <= 0) break
            if (!openProfileTab(target)) break

            if (cells().isEmpty()) {
                Status.message("Nenhum ${target.label} restante.")
                break
            }

            var removedThisPass = 0
            var index = 0
            var step = 0

            // Uma leitura de tela por item: em algumas versões a grade se
            // reorganiza assim que o vídeo sai da lista, e uma posição lida
            // antes passaria a apontar para o vizinho.
            while (running && budget > 0 && step < BATCH) {
                step++

                val visible = cells()
                if (visible.isEmpty() || index >= visible.size) break

                val cell = visible[index]
                tap(cell.centerX, cell.centerY)
                pause(1500, 2400)

                if (find(Patterns.playerMarker) == null) {
                    back()
                    pause(800, 1400)
                    Status.update { it.copy(failed = it.failed + 1) }
                    index++
                    continue
                }

                val outcome = undo(target)
                back()
                pause(900, 1600)

                if (outcome == Outcome.REMOVED) {
                    budget--
                    removedThisPass++
                    Status.update {
                        it.copy(removed = it.removed + 1, message = "Removendo ${target.label}...")
                    }
                } else {
                    if (outcome == Outcome.FAILED) Status.update { it.copy(failed = it.failed + 1) }
                    index++
                }

                pause()
            }

            refreshGrid()

            if (removedThisPass == 0) {
                Status.message(
                    "Nada removido nesta varredura. Se o app mudou, ajuste os rótulos em Patterns.kt.",
                )
                break
            }
        }

        return budget
    }

    private fun verifyEmpty(target: Target): Boolean {
        if (!openProfileTab(target)) return false
        return cells().isEmpty() || find(Patterns.emptyState) != null
    }
}
