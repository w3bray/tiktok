package com.w3bray.tiktokcleaner

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PatternsTest {

    @Test
    fun `casa content-description em portugues e ingles`() {
        assertTrue(Patterns.matches("Curtir vídeo, 1.2M curtidas", null, Patterns.likeButton))
        assertTrue(Patterns.matches("Like video", null, Patterns.likeButton))
        assertTrue(Patterns.matches(null, "Curtidos", Patterns.likedTab))
        assertTrue(Patterns.matches(null, "Liked", Patterns.likedTab))
    }

    @Test
    fun `aba de repostagens nao casa com a de curtidos`() {
        assertTrue(Patterns.matches(null, "Repostagens", Patterns.repostTab))
        assertFalse(Patterns.matches(null, "Repostagens", Patterns.likedTab))
        assertFalse(Patterns.matches(null, "Curtidos", Patterns.repostTab))
    }

    @Test
    fun `marcador do player nao casa com a aba do perfil`() {
        // "Curtidos" e a aba do perfil: nao pode ser confundida com o player.
        assertFalse(Patterns.matches(null, "Curtidos", Patterns.playerMarker))
        assertTrue(Patterns.matches("Comentar, 300 comentários", null, Patterns.playerMarker))
        assertTrue(Patterns.matches("Curtir vídeo", null, Patterns.playerMarker))
    }

    @Test
    fun `remover repostagem nao casa com repostar`() {
        // Casar errado aqui criaria uma republicacao em vez de remover.
        assertFalse(Patterns.matches(null, "Repostar", Patterns.removeRepost))
        assertTrue(Patterns.matches(null, "Remover repostagem", Patterns.removeRepost))
        assertTrue(Patterns.matches(null, "Remove repost", Patterns.removeRepost))
    }

    @Test
    fun `estado aceso e reconhecido pela descricao`() {
        assertTrue(Patterns.matches("Descurtir vídeo", null, Patterns.activeState))
        assertTrue(Patterns.matches("Unlike", null, Patterns.activeState))
        assertFalse(Patterns.matches("Curtir vídeo", null, Patterns.activeState))
    }

    @Test
    fun `texto vazio nunca casa`() {
        assertFalse(Patterns.matches(null, null, Patterns.likeButton))
        assertFalse(Patterns.matches("", "", Patterns.likeButton))
    }

    @Test
    fun `aba perfil exige o rotulo exato`() {
        assertTrue(Patterns.matches("Perfil", null, Patterns.profileTab))
        assertFalse(Patterns.matches("Perfil do criador", null, Patterns.profileTab))
    }
}
