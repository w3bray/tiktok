package com.w3bray.tiktokcleaner

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.TextUtils
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Tela única: explica o passo a passo, leva às configurações de
 * acessibilidade e dispara a limpeza. Todo o trabalho fica no serviço.
 */
class MainActivity : Activity() {

    private val main = Handler(Looper.getMainLooper())
    private lateinit var status: TextView
    private lateinit var permission: Button
    private val buttons = mutableListOf<Button>()

    private val listener: (Status.Snapshot) -> Unit = { snapshot ->
        main.post { render(snapshot) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 64, 48, 64)
            setBackgroundColor(Color.parseColor("#16181F"))
        }

        root.addView(title("TikTok Cleaner"))
        root.addView(
            paragraph(
                "Remove 100% dos vídeos curtidos e republicados da sua conta, " +
                    "tocando no app do TikTok por você.",
            ),
        )

        permission = button("1. Ativar acessibilidade") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        root.addView(permission)

        root.addView(
            paragraph(
                "Em Acessibilidade, procure \"TikTok Cleaner\" e ligue. " +
                    "Depois volte aqui e escolha o que limpar.",
            ),
        )

        root.addView(action("Limpar tudo", listOf(CleanerService.Target.REPOSTS, CleanerService.Target.LIKES)))
        root.addView(action("Só curtidos", listOf(CleanerService.Target.LIKES)))
        root.addView(action("Só republicados", listOf(CleanerService.Target.REPOSTS)))

        root.addView(
            button("Parar") {
                CleanerService.instance?.stopJob()
            },
        )

        status = paragraph("").apply {
            setTextColor(Color.parseColor("#F1F1F3"))
            setPadding(0, 40, 0, 0)
        }
        root.addView(status)

        root.addView(
            paragraph(
                "Enquanto roda, o app controla a tela — não mexa no celular. " +
                    "A remoção não tem desfazer.",
            ),
        )

        setContentView(ScrollView(this).apply { addView(root) })
    }

    override fun onStart() {
        super.onStart()
        Status.observe(listener)
    }

    override fun onStop() {
        Status.forget(listener)
        super.onStop()
    }

    private fun render(snapshot: Status.Snapshot) {
        val enabled = isServiceEnabled()
        permission.text = if (enabled) "Acessibilidade ativada ✓" else "1. Ativar acessibilidade"
        buttons.forEach { it.isEnabled = enabled && !snapshot.running }

        val counters = if (snapshot.removed > 0 || snapshot.failed > 0) {
            "\nRemovidos: ${snapshot.removed}" + if (snapshot.failed > 0) " · falhas: ${snapshot.failed}" else ""
        } else {
            ""
        }

        status.text = when {
            !enabled -> "Ative a acessibilidade para começar."
            else -> snapshot.message + counters
        }
    }

    /** O serviço só funciona se o usuário tiver ligado nas configurações. */
    private fun isServiceEnabled(): Boolean {
        val expected = "$packageName/${CleanerService::class.java.name}"
        val enabled = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false

        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(enabled)
        while (splitter.hasNext()) {
            if (splitter.next().equals(expected, ignoreCase = true)) return true
        }
        return false
    }

    // ------------------------------------------------------------ widgets

    private fun action(label: String, targets: List<CleanerService.Target>): Button =
        button(label) {
            val service = CleanerService.instance
            if (service == null) {
                Status.message("Serviço desligado. Ative a acessibilidade primeiro.")
                return@button
            }
            service.startJob(CleanerService.Job(targets, Int.MAX_VALUE))
        }.also { buttons.add(it) }

    private fun button(label: String, onClick: () -> Unit): Button =
        Button(this).apply {
            text = label
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = 20 }
        }

    private fun title(text: String): TextView =
        TextView(this).apply {
            this.text = text
            textSize = 22f
            setTextColor(Color.parseColor("#FE2C55"))
            gravity = Gravity.START
        }

    private fun paragraph(text: String): TextView =
        TextView(this).apply {
            this.text = text
            textSize = 14f
            setTextColor(Color.parseColor("#A8ABB4"))
            setPadding(0, 24, 0, 8)
        }
}
