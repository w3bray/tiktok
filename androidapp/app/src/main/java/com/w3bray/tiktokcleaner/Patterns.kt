package com.w3bray.tiktokcleaner

import java.text.Normalizer

/**
 * Rótulos do app do TikTok, em português e inglês. São casados contra o
 * content-description e o texto de cada view — o TikTok renomeia botões entre
 * versões, e é aqui que se conserta quando isso acontece.
 */
object Patterns {

    val packages = listOf(
        "com.zhiliaoapp.musically",
        "com.ss.android.ugc.trill",
        "com.ss.android.ugc.aweme",
    )

    val profileTab = listOf("^perfil$", "^profile$", "^eu$", "^me$", "aba perfil", "profile tab")
    val likedTab = listOf("curtid", "\\bliked\\b", "videos curtidos", "liked videos")
    val repostTab = listOf("repost", "republicad", "repostagem")

    val likeButton = listOf("curtir", "curtid", "\\blike\\b", "\\bliked\\b", "descurtir", "unlike")
    val repostButton = listOf("^repostar$", "^repost$", "repostado", "reposted")
    val shareButton = listOf("compartilhar", "\\bshare\\b", "enviar para")
    val removeRepost = listOf(
        "remover.*repost",
        "remove.*repost",
        "desfazer.*repost",
        "remover.*republica",
        "cancelar.*repost",
    )
    val confirm = listOf("^remover$", "^remove$", "^confirmar$", "^confirm$", "^sim$", "^yes$")

    val emptyState = listOf(
        "nada por aqui", "nenhum video", "sem videos", "no videos", "nothing here", "no content",
    )

    /** Views que só existem na tela do player, para confirmar que o vídeo abriu. */
    val playerMarker = listOf("comentar", "\\bcomment", "curtir video", "like video")

    /** Descrições que indicam que o item JÁ está curtido/repostado. */
    val activeState = listOf("descurtir", "unlike", "curtido", "\\bliked\\b", "repostado", "reposted")

    private val cache = HashMap<String, Regex>()
    private val diacritics = Regex("\\p{Mn}+")

    private fun regex(pattern: String): Regex =
        cache.getOrPut(pattern) { Regex(pattern, RegexOption.IGNORE_CASE) }

    /**
     * Tira os acentos antes de comparar: o app mostra "Curtir vídeo" e os
     * padrões são escritos sem acento, então sem isso nada casaria.
     */
    private fun strip(text: String): String =
        Normalizer.normalize(text, Normalizer.Form.NFD).replace(diacritics, "")

    fun matches(description: CharSequence?, text: CharSequence?, patterns: List<String>): Boolean {
        val haystack = strip(listOfNotNull(description, text).joinToString(" ").trim())
        if (haystack.isEmpty()) return false
        return patterns.any { regex(it).containsMatchIn(haystack) }
    }
}
