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
    fun `aba de favoritos e sub-aba de colecoes`() {
        assertTrue(Patterns.matches(null, "Favoritos", Patterns.favoritesTab))
        assertTrue(Patterns.matches(null, "Saved", Patterns.favoritesTab))
        assertTrue(Patterns.matches(null, "Coleções", Patterns.collectionsTab))
        assertTrue(Patterns.matches(null, "Collections", Patterns.collectionsTab))
    }

    @Test
    fun `abas das quatro categorias nao se confundem`() {
        val rotulos = mapOf(
            "Curtidos" to Patterns.likedTab,
            "Favoritos" to Patterns.favoritesTab,
            "Repostagens" to Patterns.repostTab,
            "Coleções" to Patterns.collectionsTab,
        )

        for ((rotulo, correta) in rotulos) {
            for ((outro, lista) in rotulos) {
                val casou = Patterns.matches(null, rotulo, lista)
                if (lista === correta) {
                    assertTrue("$rotulo deveria casar com a propria aba", casou)
                } else {
                    assertFalse("$rotulo nao pode casar com a aba de $outro", casou)
                }
            }
        }
    }

    @Test
    fun `botao de salvar e reconhecido`() {
        assertTrue(Patterns.matches("Adicionar aos favoritos", null, Patterns.bookmarkButton))
        assertTrue(Patterns.matches("Salvar vídeo", null, Patterns.bookmarkButton))
        assertFalse(Patterns.matches("Curtir vídeo", null, Patterns.bookmarkButton))
    }

    @Test
    fun `excluir colecao nao casa com criar colecao`() {
        // Casar errado aqui criaria uma pasta em vez de apagar.
        assertTrue(Patterns.matches(null, "Excluir coleção", Patterns.deleteCollection))
        assertTrue(Patterns.matches(null, "Delete collection", Patterns.deleteCollection))
        assertFalse(Patterns.matches(null, "Criar coleção", Patterns.deleteCollection))
        assertFalse(Patterns.matches(null, "Nova coleção", Patterns.deleteCollection))
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
